import {
  canonical,
  hash,
  identifier,
  plainText,
  SyncError,
} from "../sync/protocol";
import type {
  AccountBinding,
  AccountGrant,
  AccountIdentity,
  AccountProfile,
  SignedGrant,
  SignedIdentity,
} from "../sync/accounts";
import { serverBaseUrl } from "../sync/server-url";
import { AccountCipher, sign, signingKeys, verify } from "./account-crypto";
import type { AuthUser } from "./accounts";
import { Sessions } from "./sessions";
import { audit, liveSession, rateLimit } from "./security";
import type { MetadataStore, SqlStatement } from "./storage";

export type AccountSession = AuthUser & { session_digest: string };
interface IdentityRow {
  generation: string;
  public_key: string;
  private_key: string;
}
interface PeerRow {
  peer_server_id: string;
  peer_user_id: string;
  descriptor: string;
  state: "active" | "removed";
  updated_at: number;
  change_id: string;
}
export interface AccountHubOptions {
  vaultKey?: string;
  name?: string;
  publicUrl?: string;
}
export class AccountHub {
  readonly cipher: AccountCipher;
  constructor(
    readonly db: MetadataStore,
    readonly sessions: Sessions,
    readonly serverId: () => Promise<string>,
    readonly options: AccountHubOptions,
  ) {
    this.cipher = new AccountCipher(options.vaultKey);
  }
  private async context(userId: string) {
    return `${await this.serverId()}:account:${userId}:identity`;
  }
  private async row(userId: string) {
    return (
      await this.db.all<IdentityRow>(
        "SELECT generation,public_key,private_key FROM account_identities WHERE user_id=?",
        [userId],
      )
    )[0];
  }
  async identity(
    user: AccountSession,
    requestBase: string,
    create = false,
  ): Promise<SignedIdentity | null> {
    let row = await this.row(user.id);
    if (!row && create) {
      const keys = await signingKeys(),
        generation = crypto.randomUUID(),
        permission = liveSession(user);
      await this.db.run(
        `INSERT OR IGNORE INTO account_identities(user_id,generation,public_key,private_key) SELECT ?,?,?,? WHERE EXISTS(${permission.sql})`,
        [
          user.id,
          generation,
          JSON.stringify(keys.publicKey),
          await this.cipher.seal(await this.context(user.id), keys.privateKey),
          ...permission.values!,
        ],
      );
      row = await this.row(user.id);
      if (!row)
        throw new SyncError(401, "UNAUTHORIZED", "登录已过期，请重新登录。");
    }
    if (!row) return null;
    const identity: AccountIdentity = {
      format: "showai-account-identity-v1",
      serverId: await this.serverId(),
      url: serverBaseUrl(this.options.publicUrl ?? requestBase),
      serverName: this.options.name ?? "ShowAI Server",
      user: { id: user.id, name: user.name },
      generation: row.generation,
      publicKey: JSON.parse(row.public_key),
    };
    const privateKey = await this.cipher.open<JsonWebKey>(
      await this.context(user.id),
      row.private_key,
    );
    return { identity, signature: await sign(privateKey, identity) };
  }
  async profile(user: AccountSession, base: string): Promise<AccountProfile> {
    const rows = await this.db.all<PeerRow>(
      "SELECT * FROM account_peers WHERE user_id=? ORDER BY peer_server_id",
      [user.id],
    );
    return {
      own: await this.identity(user, base),
      peers: rows.map((row) => ({
        descriptor: JSON.parse(row.descriptor),
        state: row.state,
        updatedAt: row.updated_at,
        changeId: row.change_id,
      })),
    };
  }
  private async descriptor(value: unknown): Promise<SignedIdentity> {
    const descriptor = value as SignedIdentity,
      identity = descriptor?.identity;
    if (
      !identity ||
      identity.format !== "showai-account-identity-v1" ||
      !identity.user ||
      typeof descriptor.signature !== "string"
    )
      throw new SyncError(400, "INVALID_IDENTITY", "无效的绑定账号身份。");
    identifier(identity.serverId);
    identifier(identity.user.id);
    identifier(identity.generation);
    plainText(identity.serverName, 100);
    plainText(identity.user.name, 100);
    if (
      serverBaseUrl(identity.url) !== identity.url ||
      !(await verify(identity.publicKey, identity, descriptor.signature))
    )
      throw new SyncError(
        400,
        "INVALID_IDENTITY",
        "账号身份签名或服务器地址不匹配。",
      );
    return descriptor;
  }
  async bind(
    user: AccountSession,
    value: unknown,
    state: "active" | "removed" = "active",
  ) {
    return this.merge(
      user,
      [
        {
          descriptor: await this.descriptor(value),
          state,
          updatedAt: Date.now(),
          changeId: crypto.randomUUID(),
        },
      ],
      true,
    );
  }
  async merge(user: AccountSession, input: unknown, replace = false) {
    if (!Array.isArray(input) || input.length > 31)
      throw new SyncError(
        400,
        "BINDING_LIMIT",
        "每个账号最多绑定 31 个其他服务。",
      );
    const ownId = await this.serverId(),
      own = await this.row(user.id),
      permission = liveSession(user);
    if (!own)
      throw new SyncError(
        409,
        "IDENTITY_REQUIRED",
        "请先建立此账号的绑定身份。",
      );
    const prepared: {
      binding: AccountBinding;
      descriptor: SignedIdentity;
      previous?: PeerRow;
    }[] = [];
    const seen = new Set<string>();
    for (const value of input) {
      const binding = value as AccountBinding,
        descriptor = await this.descriptor(binding?.descriptor),
        identity = descriptor.identity;
      if (
        !["active", "removed"].includes(binding.state) ||
        !Number.isSafeInteger(binding.updatedAt) ||
        binding.updatedAt < 0 ||
        binding.updatedAt > Date.now() + 300_000
      )
        throw new SyncError(400, "INVALID_BINDING", "无效的账号绑定记录。");
      identifier(binding.changeId);
      if (identity.serverId === ownId) {
        if (
          identity.user.id !== user.id ||
          identity.generation !== own.generation ||
          canonical(identity.publicKey) !==
            canonical(JSON.parse(own.public_key))
        )
          throw new SyncError(
            409,
            "ACCOUNT_MISMATCH",
            "同一服务器上的账号身份不一致，不能合并这两组绑定。",
          );
        continue;
      }
      if (seen.has(identity.serverId))
        throw new SyncError(
          400,
          "INVALID_BINDING",
          "同一请求不能重复指定服务器。",
        );
      seen.add(identity.serverId);
      const previous = (
        await this.db.all<PeerRow>(
          "SELECT * FROM account_peers WHERE user_id=? AND peer_server_id=?",
          [user.id, identity.serverId],
        )
      )[0];
      if (
        previous &&
        (binding.updatedAt < previous.updated_at ||
          (binding.updatedAt === previous.updated_at &&
            binding.changeId <= previous.change_id))
      )
        continue;
      if (
        previous?.state === "active" &&
        !replace &&
        canonical(
          (JSON.parse(previous.descriptor) as SignedIdentity).identity,
        ) !== canonical(identity)
      )
        throw new SyncError(
          409,
          "BINDING_IDENTITY_CHANGED",
          "绑定服务器的身份发生变化，请重新登录该服务器后绑定。",
        );
      prepared.push({ binding, descriptor, previous });
    }
    if (!prepared.length) return { ok: true };
    // Validate the entire group before writing. One guarded INSERT handles every
    // peer, so malformed later entries, concurrent identity changes or the cap
    // cannot leave only part of a requested group bound.
    const rows = prepared.map(({ binding, descriptor, previous }) => ({
      serverId: descriptor.identity.serverId,
      userId: descriptor.identity.user.id,
      descriptor: JSON.stringify(descriptor),
      state: binding.state,
      updatedAt: binding.updatedAt,
      changeId: binding.changeId,
      previous: previous
        ? {
            changeId: previous.change_id,
            updatedAt: previous.updated_at,
            state: previous.state,
          }
        : null,
    }));
    const encodedRows = JSON.stringify(rows);
    const statements: SqlStatement[] = [
      {
        sql: `INSERT INTO account_peers(user_id,peer_server_id,peer_user_id,descriptor,state,updated_at,change_id)
        SELECT ?,json_extract(value,'$.serverId'),json_extract(value,'$.userId'),json_extract(value,'$.descriptor'),json_extract(value,'$.state'),json_extract(value,'$.updatedAt'),json_extract(value,'$.changeId')
        FROM json_each(?) WHERE EXISTS(${permission.sql})
        AND EXISTS(SELECT 1 FROM account_identities WHERE user_id=? AND generation=?)
        AND (SELECT COUNT(*) FROM account_peers WHERE user_id=?)+(SELECT COUNT(*) FROM json_each(?) AS incoming WHERE NOT EXISTS(SELECT 1 FROM account_peers WHERE user_id=? AND peer_server_id=json_extract(incoming.value,'$.serverId')))<=31
        AND NOT EXISTS(SELECT 1 FROM json_each(?) AS incoming LEFT JOIN account_peers AS previous ON previous.user_id=? AND previous.peer_server_id=json_extract(incoming.value,'$.serverId')
          WHERE CASE WHEN json_type(incoming.value,'$.previous')='null' THEN previous.peer_server_id IS NOT NULL
          ELSE previous.peer_server_id IS NULL OR previous.change_id<>json_extract(incoming.value,'$.previous.changeId') OR previous.updated_at<>json_extract(incoming.value,'$.previous.updatedAt') OR previous.state<>json_extract(incoming.value,'$.previous.state') END)
        ON CONFLICT(user_id,peer_server_id) DO UPDATE SET peer_user_id=excluded.peer_user_id,descriptor=excluded.descriptor,state=excluded.state,updated_at=excluded.updated_at,change_id=excluded.change_id`,
        values: [
          user.id,
          encodedRows,
          ...permission.values!,
          user.id,
          own.generation,
          user.id,
          encodedRows,
          user.id,
          encodedRows,
          user.id,
        ],
      },
    ];
    for (const { binding, descriptor } of prepared) {
      const identity = descriptor.identity;
      statements.push(
        {
          sql: "UPDATE sessions SET revoked=1 WHERE user_id=? AND origin_server=? AND (origin_user<>? OR origin_generation<>? OR EXISTS(SELECT 1 FROM account_peers WHERE user_id=? AND peer_server_id=? AND state='removed')) AND EXISTS(SELECT 1 FROM account_peers WHERE user_id=? AND peer_server_id=? AND change_id=?)",
          values: [
            user.id,
            identity.serverId,
            identity.user.id,
            identity.generation,
            user.id,
            identity.serverId,
            user.id,
            identity.serverId,
            binding.changeId,
          ],
        },
        audit(
          "account.binding",
          user.id,
          null,
          {
            serverId: identity.serverId,
            userId: identity.user.id,
            state: binding.state,
          },
          {
            sql: "SELECT 1 FROM account_peers WHERE user_id=? AND peer_server_id=? AND change_id=?",
            values: [user.id, identity.serverId, binding.changeId],
          },
        ),
      );
    }
    const result = await this.db.batch(statements);
    if (!result[0].changes)
      throw new SyncError(
        409,
        "BINDING_UNAVAILABLE",
        "登录或绑定身份已变化，或绑定数量已达上限，请刷新后重试。",
      );
    return { ok: true };
  }
  async grant(
    user: AccountSession,
    input: Record<string, unknown>,
  ): Promise<SignedGrant> {
    const peerServerId = identifier(input.serverId),
      deviceId = identifier(input.deviceId),
      device = plainText(input.device, 200);
    const peer = (
      await this.db.all<PeerRow>(
        "SELECT * FROM account_peers WHERE user_id=? AND peer_server_id=? AND state='active'",
        [user.id, peerServerId],
      )
    )[0];
    const own = await this.row(user.id);
    if (!peer || !own)
      throw new SyncError(403, "NOT_BOUND", "这两个服务器账号尚未绑定。");
    const now = Date.now();
    const grant: AccountGrant = {
      format: "showai-account-grant-v1",
      issuer: {
        serverId: await this.serverId(),
        userId: user.id,
        generation: own.generation,
      },
      audience: { serverId: peerServerId, userId: peer.peer_user_id },
      deviceId,
      device,
      nonce: crypto.randomUUID(),
      issuedAt: now,
      expiresAt: now + 60_000,
    };
    const signature = await sign(
      await this.cipher.open<JsonWebKey>(
        await this.context(user.id),
        own.private_key,
      ),
      grant,
    );
    const permission = liveSession(user);
    if (!(await this.db.all(permission.sql, permission.values)).length)
      throw new SyncError(401, "UNAUTHORIZED", "登录已过期，请重新登录。");
    return { grant, signature };
  }
  async exchange(input: Record<string, unknown>, source: string) {
    await rateLimit(this.db, {
      scope: "account.exchange",
      identity: source,
      maximum: 120,
      windowMs: 60_000,
    });
    const signed = input as unknown as SignedGrant,
      grant = signed.grant,
      now = Date.now();
    if (
      !grant ||
      grant.format !== "showai-account-grant-v1" ||
      !grant.issuer ||
      !grant.audience ||
      !Number.isSafeInteger(grant.issuedAt) ||
      !Number.isSafeInteger(grant.expiresAt) ||
      grant.issuedAt > now + 5000 ||
      grant.expiresAt <= now ||
      grant.expiresAt > grant.issuedAt + 60_000 ||
      grant.issuedAt < now - 60_000 ||
      grant.audience.serverId !== (await this.serverId()) ||
      typeof signed.signature !== "string"
    )
      throw new SyncError(
        401,
        "INVALID_ACCOUNT_GRANT",
        "绑定授权已过期或不适用于此服务器。",
      );
    identifier(grant.issuer.serverId);
    identifier(grant.issuer.userId);
    identifier(grant.issuer.generation);
    identifier(grant.audience.userId);
    identifier(grant.deviceId);
    identifier(grant.nonce);
    plainText(grant.device, 200);
    const peer = (
      await this.db.all<PeerRow>(
        "SELECT * FROM account_peers WHERE user_id=? AND peer_server_id=? AND peer_user_id=? AND state='active'",
        [grant.audience.userId, grant.issuer.serverId, grant.issuer.userId],
      )
    )[0];
    const identity = peer
      ? (JSON.parse(peer.descriptor) as SignedIdentity).identity
      : undefined;
    if (
      !identity ||
      identity.generation !== grant.issuer.generation ||
      !(await verify(identity.publicKey, grant, signed.signature))
    )
      throw new SyncError(
        401,
        "INVALID_ACCOUNT_GRANT",
        "账号绑定已撤销或授权签名无效。",
      );
    const user = (
      await this.db.all<AuthUser>(
        "SELECT id,name,auth_version FROM users WHERE id=?",
        [grant.audience.userId],
      )
    )[0];
    if (!user)
      throw new SyncError(401, "INVALID_ACCOUNT_GRANT", "账号绑定已失效。");
    const digest = await hash(canonical(grant));
    await this.db.run(
      "DELETE FROM account_grant_nonces WHERE digest IN(SELECT digest FROM account_grant_nonces WHERE expires_at<=? LIMIT 100)",
      [now],
    );
    return this.sessions.create(user, grant.device, {
      kind: "federated",
      originServer: grant.issuer.serverId,
      originUser: grant.issuer.userId,
      originGeneration: grant.issuer.generation,
      condition: {
        sql: "SELECT 1 FROM account_peers WHERE user_id=? AND peer_server_id=? AND peer_user_id=? AND descriptor=? AND state='active' AND NOT EXISTS(SELECT 1 FROM account_grant_nonces WHERE digest=?) AND ?>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)",
        values: [
          user.id,
          grant.issuer.serverId,
          grant.issuer.userId,
          peer!.descriptor,
          digest,
          grant.expiresAt,
        ],
      },
      after: (sessionDigest) => [
        {
          sql: "INSERT INTO account_grant_nonces(digest,expires_at) SELECT ?,? WHERE EXISTS(SELECT 1 FROM sessions WHERE digest=?)",
          values: [digest, grant.expiresAt, sessionDigest],
        },
      ],
    });
  }
}

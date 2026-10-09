import { identifier, plainText, SyncError } from "../sync/protocol";
import type { AccountResource } from "../sync/accounts";
import { serverBaseUrl } from "../sync/server-url";
import type { AccountSession, AccountHubOptions } from "./account-hub";
import { AccountCipher } from "./account-crypto";
import { audit, liveSession } from "./security";
import type { MetadataStore } from "./storage";

type ResourceConfig = Pick<
  AccountResource,
  "name" | "provider" | "baseUrl" | "model" | "protocol" | "credential"
>;
export interface HostedChatGptSecret {
  kind: "chatgpt";
  clientId: string;
  subject: string;
  email: string;
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  expiresAt: number;
  scopes: string[];
}
interface ApiSecret {
  kind: "api-key";
  apiKey: string;
}
interface ResourceRow {
  id: string;
  config: string;
  secret: string | null;
  version: string;
  updated_at: string;
  refresh_lease: string | null;
  refresh_started_at: number | null;
  publication_id: string | null;
  request_hash: string | null;
}
const providers = [
  "chatgpt",
  "openrouter",
  "deepseek",
  "openai",
  "moonshot",
  "custom",
];
export class AccountResources {
  readonly cipher: AccountCipher;
  constructor(
    readonly db: MetadataStore,
    readonly serverId: () => Promise<string>,
    readonly options: AccountHubOptions,
  ) {
    this.cipher = new AccountCipher(options.vaultKey);
  }
  private async context(userId: string, id: string) {
    return `${await this.serverId()}:account:${userId}:resource:${id}`;
  }
  private async row(userId: string, id: string) {
    return (
      await this.db.all<ResourceRow>(
        "SELECT * FROM account_resources WHERE user_id=? AND id=?",
        [userId, identifier(id)],
      )
    )[0];
  }
  private config(input: Record<string, unknown>): ResourceConfig {
    const config: ResourceConfig = {
      name: plainText(input.name, 100),
      provider: input.provider as ResourceConfig["provider"],
      baseUrl: plainText(input.baseUrl, 2000),
      model:
        typeof input.model === "string" ? input.model.trim().slice(0, 200) : "",
      protocol: input.protocol as ResourceConfig["protocol"],
      credential: input.credential as ResourceConfig["credential"],
    };
    const url = new URL(config.baseUrl);
    if (
      !providers.includes(config.provider) ||
      !["responses", "chat"].includes(config.protocol) ||
      !["api-key", "chatgpt"].includes(config.credential) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        ))
    )
      throw new SyncError(
        400,
        "INVALID_RESOURCE",
        "模型资源的类型或地址无效。",
      );
    if (
      config.credential === "chatgpt" &&
      (config.provider !== "chatgpt" ||
        config.protocol !== "responses" ||
        config.baseUrl !== "https://api.openai.com/v1")
    )
      throw new SyncError(
        400,
        "INVALID_RESOURCE",
        "ChatGPT 授权只能用于官方 Responses API。",
      );
    return config;
  }
  private secret(
    config: ResourceConfig,
    value: unknown,
  ): ApiSecret | HostedChatGptSecret {
    const input = value as Record<string, unknown>;
    if (config.credential === "api-key")
      return { kind: "api-key", apiKey: plainText(input?.apiKey, 8192) };
    if (
      !input ||
      !Array.isArray(input.scopes) ||
      input.scopes.some((scope) => typeof scope !== "string") ||
      !input.scopes.includes("chatgpt.tokens.use.direct") ||
      !Number.isFinite(input.expiresAt)
    )
      throw new SyncError(
        400,
        "INVALID_RESOURCE_CREDENTIAL",
        "请先在来源设备完成 ChatGPT 套餐授权。",
      );
    return {
      kind: "chatgpt",
      clientId: plainText(input.clientId, 200),
      subject: plainText(input.subject, 300),
      email: plainText(input.email, 300),
      accessToken: plainText(input.accessToken, 16000),
      idToken: plainText(input.idToken, 16000),
      refreshToken: input.refreshToken
        ? plainText(input.refreshToken, 16000)
        : undefined,
      expiresAt: input.expiresAt as number,
      scopes: input.scopes as string[],
    };
  }
  private async publicRow(
    user: AccountSession,
    row: ResourceRow,
    base: string,
  ): Promise<AccountResource> {
    const config = JSON.parse(row.config) as ResourceConfig;
    const secret = row.secret
      ? await this.cipher.open<ApiSecret | HostedChatGptSecret>(
          await this.context(user.id, row.id),
          row.secret,
        )
      : null;
    return {
      id: row.id,
      ...config,
      connected: !!secret,
      account: secret?.kind === "chatgpt" ? secret.email : undefined,
      version: row.version,
      updatedAt: row.updated_at,
      source: {
        serverId: await this.serverId(),
        serverName: this.options.name ?? "ShowAI Server",
        url: serverBaseUrl(this.options.publicUrl ?? base),
        user: { id: user.id, name: user.name },
      },
    };
  }
  async list(user: AccountSession, base: string) {
    return Promise.all(
      (
        await this.db.all<ResourceRow>(
          "SELECT * FROM account_resources WHERE user_id=? ORDER BY updated_at DESC LIMIT 100",
          [user.id],
        )
      ).map((row) => this.publicRow(user, row, base)),
    );
  }
  async save(
    user: AccountSession,
    input: Record<string, unknown>,
    base: string,
  ) {
    const id = identifier(input.id),
      config = this.config(input),
      previous = await this.row(user.id, id),
      permission = liveSession(user);
    const supplied =
      input.secret === undefined
        ? undefined
        : this.secret(config, input.secret);
    const publication = input.publicationId
      ? identifier(input.publicationId)
      : null;
    const requestHash = publication
      ? await this.cipher.fingerprint(await this.context(user.id, id), {
          config,
          supplied,
          publication,
        })
      : null;
    if (
      previous &&
      (JSON.parse(previous.config) as ResourceConfig).credential !==
        config.credential
    )
      throw new SyncError(
        409,
        "RESOURCE_KIND_CHANGED",
        "请先移除原资源，再添加不同类型的资源。",
      );
    if (!previous && !supplied)
      throw new SyncError(
        400,
        "RESOURCE_CREDENTIAL_REQUIRED",
        "请提供资源的授权凭据。",
      );
    const secret = supplied
      ? await this.cipher.seal(await this.context(user.id, id), supplied)
      : previous!.secret;
    // Identical publication retries do not rotate or overwrite a refresh token.
    if (previous && publication && previous.publication_id === publication) {
      if (previous.request_hash !== requestHash)
        throw new SyncError(
          409,
          "PUBLICATION_ID_REUSED",
          "同一次资源保存的内容发生变化，请使用新的保存操作。",
        );
      return this.publicRow(user, previous, base);
    }
    if (previous && input.version !== previous.version)
      throw new SyncError(
        409,
        "RESOURCE_CHANGED",
        "资源已在其他设备更新，请刷新后再保存。",
      );
    const version = crypto.randomUUID();
    const at = new Date().toISOString();
    const result = await this.db.batch([
      {
        sql: `INSERT INTO account_resources(user_id,id,config,secret,version,updated_at,publication_id,request_hash) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(${permission.sql}) AND ((SELECT COUNT(*) FROM account_resources WHERE user_id=?)<100 OR EXISTS(SELECT 1 FROM account_resources WHERE user_id=? AND id=?)) ON CONFLICT(user_id,id) DO UPDATE SET config=excluded.config,secret=excluded.secret,version=excluded.version,updated_at=excluded.updated_at,publication_id=excluded.publication_id,request_hash=excluded.request_hash,refresh_lease=NULL,refresh_started_at=NULL WHERE account_resources.version=? AND (account_resources.refresh_lease IS NULL OR ?=1)`,
        values: [
          user.id,
          id,
          JSON.stringify(config),
          secret,
          version,
          at,
          publication,
          requestHash,
          ...permission.values!,
          user.id,
          user.id,
          id,
          previous?.version ?? "",
          supplied && input.reauthorize === true ? 1 : 0,
        ],
      },
      audit(
        "account.resource-save",
        user.id,
        null,
        { id, provider: config.provider },
        {
          sql: "SELECT 1 FROM account_resources WHERE user_id=? AND id=? AND version=?",
          values: [user.id, id, version],
        },
      ),
    ]);
    if (!result[0].changes)
      throw new SyncError(
        409,
        "RESOURCE_CHANGED",
        "资源正在更新、登录已过期或容量已达上限，请刷新后重试。",
      );
    return this.publicRow(user, (await this.row(user.id, id))!, base);
  }
  async remove(user: AccountSession, id: string) {
    identifier(id);
    const permission = liveSession(user);
    const result = await this.db.run(
      `DELETE FROM account_resources WHERE user_id=? AND id=? AND refresh_lease IS NULL AND EXISTS(${permission.sql})`,
      [user.id, id, ...permission.values!],
    );
    if (!result.changes && (await this.row(user.id, id)))
      throw new SyncError(409, "RESOURCE_BUSY", "资源正在刷新，请稍后重试。");
    return { ok: true };
  }
  async access(user: AccountSession, id: string, force = false) {
    let row = await this.row(user.id, id);
    if (!row?.secret)
      throw new SyncError(
        404,
        "RESOURCE_NOT_FOUND",
        "资源不存在或授权已断开。",
      );
    let saved = await this.cipher.open<ApiSecret | HostedChatGptSecret>(
      await this.context(user.id, id),
      row.secret,
    );
    const permission = liveSession(user);
    if (!(await this.db.all(permission.sql, permission.values)).length)
      throw new SyncError(401, "UNAUTHORIZED", "登录已过期，请重新登录。");
    if (saved.kind === "api-key")
      return { token: saved.apiKey, expiresAt: Date.now() + 3600_000 };
    if (!force && saved.expiresAt > Date.now() + 60000)
      return { token: saved.accessToken, expiresAt: saved.expiresAt };
    if (!saved.refreshToken)
      throw new SyncError(
        401,
        "RESOURCE_REAUTHORIZE",
        "ChatGPT 授权已过期，请重新授权。",
      );
    if (row.refresh_lease)
      throw new SyncError(
        409,
        "RESOURCE_BUSY",
        "来源服务器正在刷新授权；长时间未完成时请重新授权。",
      );
    const lease = crypto.randomUUID();
    const acquired = await this.db.run(
      `UPDATE account_resources SET refresh_lease=?,refresh_started_at=? WHERE user_id=? AND id=? AND version=? AND refresh_lease IS NULL AND EXISTS(${permission.sql})`,
      [lease, Date.now(), user.id, id, row.version, ...permission.values!],
    );
    if (!acquired.changes)
      throw new SyncError(
        409,
        "RESOURCE_BUSY",
        "授权正在其他请求中刷新，请稍后重试。",
      );
    // The durable lease is not stolen after a timeout: a crashed HTTP exchange
    // may already have rotated the provider's refresh token. Reauthorization
    // resolves that uncertainty instead of starting a second refresh owner.
    const response = await fetch(
      "https://auth.openai.com/api/accounts/oauth/token",
      {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: saved.clientId,
          refresh_token: saved.refreshToken,
          resource: "https://api.openai.com/v1",
        }),
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      },
    );
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok || typeof data.access_token !== "string") {
      // A known rejection consumed no successful response. Clearing this lease
      // still requires explicit reauthorization for invalid provider grants.
      await this.db.run(
        "UPDATE account_resources SET refresh_lease=NULL,refresh_started_at=NULL WHERE user_id=? AND id=? AND refresh_lease=?",
        [user.id, id, lease],
      );
      throw new SyncError(
        401,
        "RESOURCE_REAUTHORIZE",
        "ChatGPT 授权无法刷新，请在来源服务器重新授权。",
      );
    }
    const expiresAt = Date.now() + Number(data.expires_in) * 1000;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
      throw new Error(
        "Invalid provider token expiration; resource needs reauthorization.",
      );
    saved = {
      ...saved,
      accessToken: data.access_token,
      refreshToken:
        typeof data.refresh_token === "string"
          ? data.refresh_token
          : saved.refreshToken,
      idToken:
        typeof data.id_token === "string" ? data.id_token : saved.idToken,
      expiresAt,
      scopes:
        typeof data.scope === "string" ? data.scope.split(/\s+/) : saved.scopes,
    };
    const version = crypto.randomUUID();
    const updated = await this.db.run(
      "UPDATE account_resources SET secret=?,version=?,updated_at=?,refresh_lease=NULL,refresh_started_at=NULL WHERE user_id=? AND id=? AND version=? AND refresh_lease=?",
      [
        await this.cipher.seal(await this.context(user.id, id), saved),
        version,
        new Date().toISOString(),
        user.id,
        id,
        row.version,
        lease,
      ],
    );
    if (!updated.changes)
      throw new Error(
        "Provider token rotated but vault update failed; resource needs reauthorization.",
      );
    row = (await this.row(user.id, id))!;
    if (!(await this.db.all(permission.sql, permission.values)).length)
      throw new SyncError(401, "UNAUTHORIZED", "登录已过期，请重新登录。");
    return { token: saved.accessToken, expiresAt: saved.expiresAt };
  }
}

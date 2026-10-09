import {
  hash,
  plainText,
  syncProtocol,
  token,
  SyncError,
} from "../sync/protocol";
import type { AuthUser } from "./accounts";
import { audit } from "./security";
import type { MetadataStore, SqlStatement } from "./storage";

export interface SessionOptions {
  kind?: "session" | "personal" | "federated";
  originServer?: string;
  originUser?: string;
  originGeneration?: string;
  condition?: SqlStatement;
  after?: (digest: string) => SqlStatement[];
}
export class Sessions {
  constructor(
    readonly db: MetadataStore,
    readonly serverId: () => Promise<string>,
  ) {}
  async create(user: AuthUser, device: unknown, options: SessionOptions = {}) {
    const credential = token(),
      digest = await hash(credential),
      at = new Date().toISOString();
    const kind = options.kind ?? "session";
    const expiresAt = new Date(
      Date.now() + (kind === "personal" ? 365 : 30) * 86400_000,
    ).toISOString();
    const condition = options.condition;
    const result = await this.db.batch([
      {
        sql: `INSERT INTO sessions(digest,user_id,device,created_at,expires_at,auth_version,credential_kind,origin_server,origin_user,origin_generation) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND auth_version=?) AND (SELECT COUNT(*) FROM sessions WHERE user_id=? AND revoked=0 AND expires_at>?)<100${condition ? ` AND EXISTS(${condition.sql})` : ""}`,
        values: [
          digest,
          user.id,
          typeof device === "string" ? plainText(device, 200) : "ShowAI",
          at,
          expiresAt,
          user.auth_version,
          kind,
          options.originServer ?? null,
          options.originUser ?? null,
          options.originGeneration ?? null,
          user.id,
          user.auth_version,
          user.id,
          at,
          ...(condition?.values ?? []),
        ],
      },
      ...(options.after?.(digest) ?? []),
      audit(
        "session.create",
        user.id,
        null,
        { kind },
        { sql: "SELECT 1 FROM sessions WHERE digest=?", values: [digest] },
      ),
    ]);
    if (!result[0].changes)
      throw new SyncError(
        409,
        "SESSION_UNAVAILABLE",
        "凭据已更新、授权已使用或设备会话已达上限，请重新登录或撤销旧设备。",
      );
    return {
      protocol: syncProtocol,
      serverId: await this.serverId(),
      user: { id: user.id, name: user.name },
      token: credential,
      expiresAt,
      kind,
    };
  }
}

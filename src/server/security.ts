import { hash, SyncError } from "../sync/protocol";
import type { MetadataStore, SqlStatement } from "./storage";

const encoder = new TextEncoder();
export function passwordInput(value: unknown, creating = false): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length < (creating ? 12 : 1) ||
    value.length > 1024 ||
    (creating ? /[\x00-\x1f]/ : /[\x00-\x08\x0b\x0c\x0e-\x1f]/).test(value)
  )
    throw new SyncError(
      400,
      "INVALID_PASSWORD",
      creating ? "密码需包含 12 至 1024 个字符。" : "Invalid password.",
    );
  return value;
}
async function derive(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  // This parameter set is exercised on Node and Workerd. The format fixes the
  // algorithm/parameters so future upgrades cannot silently change old hashes.
  const bytes = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: encoder.encode(salt),
        iterations: 100_000,
      },
      key,
      256,
    ),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
export async function passwordHash(password: string, salt: string) {
  return `pbkdf2-sha256$100000$${await derive(password, salt)}`;
}
export async function verifyPassword(
  password: string,
  salt: string,
  saved: string,
) {
  const legacy =
    /^[a-f0-9]{64}$/.test(saved) ||
    saved.startsWith("pbkdf2-sha256$100000$legacy-trim$");
  const expected = /^[a-f0-9]{64}$/.test(saved)
    ? saved
    : saved.match(
        /^pbkdf2-sha256\$100000\$(?:legacy-trim\$)?([a-f0-9]{64})$/,
      )?.[1];
  if (!expected) throw new Error("Unsupported stored password hash format.");
  const actual = await derive(legacy ? password.trim() : password, salt);
  let difference = 0;
  for (let index = 0; index < actual.length; index++)
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export interface RateRule {
  scope: string;
  identity: string;
  maximum: number;
  windowMs: number;
}
export class RateLimitError extends SyncError {
  constructor(readonly retryAfter: number) {
    super(429, "RATE_LIMITED", "请求过于频繁，请稍后重试。", { retryAfter });
  }
}
export async function rateLimit(db: MetadataStore, rule: RateRule) {
  const now = Date.now(),
    key = await hash(JSON.stringify([rule.scope, rule.identity]));
  const result = await db.run(
    "INSERT INTO request_limits(key,expires_at,hits) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN request_limits.expires_at<=? THEN 1 ELSE request_limits.hits+1 END,expires_at=CASE WHEN request_limits.expires_at<=? THEN excluded.expires_at ELSE request_limits.expires_at END WHERE request_limits.expires_at<=? OR request_limits.hits<?",
    [key, now + rule.windowMs, now, now, now, rule.maximum],
  );
  if (!result.changes) {
    const row = (
      await db.all<{ expires_at: number }>(
        "SELECT expires_at FROM request_limits WHERE key=?",
        [key],
      )
    )[0];
    throw new RateLimitError(
      Math.max(1, Math.ceil((row.expires_at - now) / 1000)),
    );
  }
}
export function audit(
  event: string,
  userId: string | null,
  projectId: string | null,
  details: Record<string, unknown> = {},
  condition?: SqlStatement,
): SqlStatement {
  return {
    sql: `INSERT INTO audit_events(id,at,event,user_id,project_id,details) SELECT ?,?,?,?,?,?${condition ? ` WHERE EXISTS(${condition.sql})` : ""}`,
    values: [
      crypto.randomUUID(),
      new Date().toISOString(),
      event,
      userId,
      projectId,
      JSON.stringify(details),
      ...(condition?.values ?? []),
    ],
  };
}
export function liveSession(user: {
  id: string;
  session_digest: string;
  auth_version: number;
}): SqlStatement {
  return {
    sql: "SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=? AND s.user_id=? AND s.revoked=0 AND s.expires_at>? AND s.auth_version=u.auth_version AND u.auth_version=?",
    values: [
      user.session_digest,
      user.id,
      new Date().toISOString(),
      user.auth_version,
    ],
  };
}

/** Bound allocation even if Content-Length is absent or false. */
export async function readBounded(
  request: Request,
  maximum: number,
): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum))
    throw new SyncError(413, "TOO_LARGE", "Request is too large.");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new SyncError(413, "TOO_LARGE", "Request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function secureResponse(
  response: Response,
  request: Request,
  allowedOrigins: string[],
  publicOrigin?: string,
): Response {
  const headers = new Headers(response.headers),
    origin = request.headers.get("origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set(
    "content-security-policy",
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  if (new URL(request.url).protocol === "https:")
    headers.set("strict-transport-security", "max-age=31536000");
  if (origin && (origin === publicOrigin || allowedOrigins.includes(origin))) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
    headers.set(
      "access-control-allow-methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    headers.set("access-control-allow-headers", "authorization, content-type");
    headers.set("access-control-expose-headers", "Retry-After");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

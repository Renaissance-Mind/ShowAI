import {
  hash,
  plainText,
  token,
  SyncError,
  type SyncUser,
} from "../sync/protocol";
import type { MetadataStore, SqlStatement } from "./storage";
import {
  audit,
  passwordHash,
  passwordInput,
  rateLimit,
  verifyPassword,
  liveSession,
} from "./security";

export interface AccountOptions {
  registrationKey?: string;
  registrationMode?: "controlled" | "open";
  registrationLimit?: number;
  accountLimit?: number;
}
export interface AuthUser extends SyncUser {
  auth_version: number;
}
interface PasswordUser extends AuthUser {
  password_salt: string;
  password_hash: string;
}
export async function publicLimits(
  db: MetadataStore,
  kind: "register" | "login" | "preview" | "accept" | "password",
  source: string,
  account?: string,
  registrationLimit = 20,
) {
  const rules = {
    register: {
      source: registrationLimit,
      global: 200,
      account: 6,
      windowMs: 3600_000,
    },
    login: { source: 120, global: 600, account: 12, windowMs: 60_000 },
    preview: { source: 120, global: 1200, account: 30, windowMs: 60_000 },
    accept: { source: 60, global: 600, account: 30, windowMs: 60_000 },
    password: { source: 30, global: 300, account: 6, windowMs: 60_000 },
  }[kind];
  await rateLimit(db, {
    scope: `${kind}:global`,
    identity: "global",
    maximum: rules.global,
    windowMs: rules.windowMs,
  });
  // Successful budget admission also retires a bounded set of expired counters.
  // Random failed account names must not grow durable limiter state indefinitely.
  await db.run(
    "DELETE FROM request_limits WHERE key IN(SELECT key FROM request_limits WHERE expires_at<=? ORDER BY expires_at LIMIT 100)",
    [Date.now()],
  );
  await rateLimit(db, {
    scope: `${kind}:source`,
    identity: source,
    maximum: rules.source,
    windowMs: rules.windowMs,
  });
  if (account)
    await rateLimit(db, {
      scope: `${kind}:account`,
      identity: account,
      maximum: rules.account,
      windowMs: rules.windowMs,
    });
}
function unavailableInvite(): never {
  throw new SyncError(
    403,
    "REGISTRATION_KEY_REQUIRED",
    "邀请已失效、已领满或不适用于此账号。",
  );
}
export async function registerAccount(
  db: MetadataStore,
  input: Record<string, unknown>,
  options: AccountOptions,
): Promise<AuthUser> {
  const name = plainText(input.name, 100),
    password = passwordInput(input.password, true);
  if (/[<>\r\n]/.test(name))
    throw new SyncError(
      400,
      "INVALID_ACCOUNT",
      "Account names cannot contain angle brackets or line breaks.",
    );
  const usingKey =
    options.registrationKey &&
    typeof input.registrationKey === "string" &&
    (await hash(input.registrationKey)) ===
      (await hash(options.registrationKey));
  const controlled = options.registrationMode !== "open";
  const invitation =
    !usingKey && typeof input.invite === "string"
      ? await hash(plainText(input.invite, 200))
      : null;
  if (controlled && !usingKey && !invitation)
    throw new SyncError(
      403,
      "REGISTRATION_KEY_REQUIRED",
      "请输入注册密钥或使用项目邀请注册。",
    );
  const validInvite =
    "SELECT 1 FROM invites i WHERE i.digest=? AND i.revoked=0 AND i.expires_at>? AND (i.target_name IS NULL OR i.target_name=?) AND (i.max_uses IS NULL OR (SELECT COUNT(*) FROM invite_acceptances a WHERE a.digest=i.digest)<i.max_uses)";
  if (
    invitation &&
    !(await db.all(validInvite, [invitation, new Date().toISOString(), name]))
      .length
  )
    unavailableInvite();
  if ((await db.all("SELECT id FROM users WHERE name=?", [name])).length)
    throw new SyncError(
      409,
      "REGISTRATION_UNAVAILABLE",
      "此账号无法注册，请使用账号登录。",
    );
  const id = crypto.randomUUID(),
    salt = token(),
    at = new Date().toISOString(),
    saved = await passwordHash(password, salt);
  const statements: SqlStatement[] = [
    {
      sql: `INSERT OR IGNORE INTO users(id,name,password_salt,password_hash,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM users)<?${invitation ? ` AND EXISTS(${validInvite})` : ""}`,
      values: [
        id,
        name,
        salt,
        saved,
        at,
        options.accountLimit ?? 10000,
        ...(invitation ? [invitation, at, name] : []),
      ],
    },
  ];
  if (invitation)
    statements.push(
      {
        sql: "INSERT INTO members(project_id,user_id,role) SELECT i.project_id,?,i.role FROM invites i WHERE i.digest=? AND EXISTS(SELECT 1 FROM users WHERE id=?)",
        values: [id, invitation, id],
      },
      {
        sql: "INSERT INTO invite_acceptances(digest,user_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=?)",
        values: [invitation, id, id],
      },
    );
  statements.push(
    audit(
      "account.register",
      id,
      null,
      { via: invitation ? "invite" : usingKey ? "key" : "open" },
      { sql: "SELECT 1 FROM users WHERE id=?", values: [id] },
    ),
  );
  const result = await db.batch(statements);
  if (!result[0].changes) {
    if ((await db.all("SELECT id FROM users WHERE name=?", [name])).length)
      throw new SyncError(
        409,
        "REGISTRATION_UNAVAILABLE",
        "此账号无法注册，请使用账号登录。",
      );
    if (
      (
        await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM users")
      )[0].count >= (options.accountLimit ?? 10000)
    )
      throw new SyncError(
        507,
        "ACCOUNT_CAPACITY",
        "服务注册容量已达上限，请联系服务维护者。",
      );
    unavailableInvite();
  }
  return { id, name, auth_version: 0 };
}

export async function loginAccount(
  db: MetadataStore,
  input: Record<string, unknown>,
): Promise<AuthUser> {
  const name = plainText(input.name, 100),
    password = passwordInput(input.password);
  const user = (
    await db.all<PasswordUser>("SELECT * FROM users WHERE name=?", [name])
  )[0];
  // A missing name pays the same KDF cost and returns the same public error.
  const matched = await verifyPassword(
    password,
    user?.password_salt ?? "0".repeat(64),
    user?.password_hash ?? "0".repeat(64),
  );
  if (!user || !matched)
    throw new SyncError(
      401,
      "INVALID_LOGIN",
      "Account name or password is incorrect.",
    );
  if (/^[a-f0-9]{64}$/.test(user.password_hash)) {
    const next = `pbkdf2-sha256$100000$legacy-trim$${user.password_hash}`;
    await db.run(
      "UPDATE users SET password_hash=? WHERE id=? AND password_hash=? AND auth_version=?",
      [next, user.id, user.password_hash, user.auth_version],
    );
    user.password_hash = next;
  }
  const live = (
    await db.all<PasswordUser>("SELECT * FROM users WHERE id=?", [user.id])
  )[0];
  if (
    live.password_hash !== user.password_hash ||
    live.auth_version !== user.auth_version
  )
    throw new SyncError(409, "AUTH_CHANGED", "账号凭据已更新，请重新登录。");
  return { id: user.id, name: user.name, auth_version: user.auth_version };
}

export async function changePassword(
  db: MetadataStore,
  user: AuthUser & { session_digest: string },
  input: Record<string, unknown>,
) {
  const current = (
    await db.all<PasswordUser>("SELECT * FROM users WHERE id=?", [user.id])
  )[0];
  if (
    !current ||
    current.auth_version !== user.auth_version ||
    !(await verifyPassword(
      passwordInput(input.currentPassword),
      current.password_salt,
      current.password_hash,
    ))
  )
    throw new SyncError(
      401,
      "INVALID_LOGIN",
      "Account name or password is incorrect.",
    );
  const salt = token(),
    saved = await passwordHash(passwordInput(input.newPassword, true), salt);
  const passwordAudit = audit(
    "account.password-change",
    user.id,
    null,
    {},
    {
      sql: "SELECT 1 FROM users WHERE id=? AND password_hash=?",
      values: [user.id, saved],
    },
  );
  const permission = liveSession(user);
  const result = await db.batch([
    {
      sql: `UPDATE users SET password_salt=?,password_hash=?,auth_version=auth_version+1 WHERE id=? AND password_hash=? AND auth_version=? AND EXISTS(${permission.sql})`,
      values: [
        salt,
        saved,
        user.id,
        current.password_hash,
        user.auth_version,
        ...permission.values!,
      ],
    },
    {
      sql: "UPDATE sessions SET revoked=1 WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)",
      values: [user.id, user.id, saved],
    },
    passwordAudit,
  ]);
  if (!result[0].changes)
    throw new SyncError(409, "AUTH_CHANGED", "账号凭据已更新，请重新登录。");
  return { ...user, auth_version: user.auth_version + 1 };
}

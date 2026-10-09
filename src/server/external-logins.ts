import { hash, plainText, token, SyncError } from "../sync/protocol";
import { serverEndpoint } from "../sync/server-url";
import { AccountCipher, base64url, unbase64url } from "./account-crypto";
import type { AccountSession } from "./account-hub";
import type { AccountOptions, AuthUser } from "./accounts";
import { Sessions } from "./sessions";
import { audit, liveSession, passwordHash, rateLimit } from "./security";
import type { MetadataStore } from "./storage";

export interface ExternalLoginOptions extends AccountOptions {
  vaultKey?: string;
  githubLogin?: { clientId: string; clientSecret: string };
  googleLogin?: { clientId: string; clientSecret: string };
  emailLogin?: { apiKey: string; from: string };
}
export interface LoginEnvironment {
  SHOWAI_VAULT_KEY?: string;
  SHOWAI_GITHUB_CLIENT_ID?: string;
  SHOWAI_GITHUB_CLIENT_SECRET?: string;
  SHOWAI_GOOGLE_CLIENT_ID?: string;
  SHOWAI_GOOGLE_CLIENT_SECRET?: string;
  SHOWAI_EMAIL_API_KEY?: string;
  SHOWAI_EMAIL_FROM?: string;
}
export function configuredLogins(env: LoginEnvironment): ExternalLoginOptions {
  return {
    vaultKey: env.SHOWAI_VAULT_KEY,
    githubLogin:
      env.SHOWAI_GITHUB_CLIENT_ID && env.SHOWAI_GITHUB_CLIENT_SECRET
        ? {
            clientId: env.SHOWAI_GITHUB_CLIENT_ID,
            clientSecret: env.SHOWAI_GITHUB_CLIENT_SECRET,
          }
        : undefined,
    googleLogin:
      env.SHOWAI_GOOGLE_CLIENT_ID && env.SHOWAI_GOOGLE_CLIENT_SECRET
        ? {
            clientId: env.SHOWAI_GOOGLE_CLIENT_ID,
            clientSecret: env.SHOWAI_GOOGLE_CLIENT_SECRET,
          }
        : undefined,
    emailLogin:
      env.SHOWAI_EMAIL_API_KEY && env.SHOWAI_EMAIL_FROM
        ? { apiKey: env.SHOWAI_EMAIL_API_KEY, from: env.SHOWAI_EMAIL_FROM }
        : undefined,
  };
}
interface FlowRow {
  id: string;
  provider: string;
  state_digest: string;
  poll_digest: string;
  expires_at: number;
  status: string;
  secret: string;
  claimed: number;
}
interface FlowSecret {
  verifier: string;
  nonce: string;
  redirectUri: string;
  device: string;
  registrationKey?: string;
  link?: AccountSession;
  email?: string;
  codeDigest?: string;
  user?: AuthUser;
  result?: Awaited<ReturnType<Sessions["create"]>>;
  error?: string;
  externalIdentity?: ExternalIdentity;
  confirmDigest?: string;
}
interface ExternalIdentity {
  subject: string;
  name: string;
  email?: string;
}
const encoder = new TextEncoder();
async function providerJson(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new SyncError(
      502,
      "LOGIN_PROVIDER_FAILED",
      "登录服务暂时不可用，请重试。",
    );
  const result = (await response.json()) as Record<string, unknown>;
  return result;
}
export async function googleIdentity(
  idToken: string,
  clientId: string,
  nonce: string,
  keys: (JsonWebKey & { kid?: string })[],
) {
  const parts = idToken.split(".");
  if (parts.length !== 3)
    throw new SyncError(401, "INVALID_ID_TOKEN", "Google 身份凭据无效。");
  const header = JSON.parse(
    new TextDecoder().decode(unbase64url(parts[0], 2048)),
  ) as { alg: string; kid: string };
  const claims = JSON.parse(
    new TextDecoder().decode(unbase64url(parts[1], 16000)),
  ) as Record<string, unknown>;
  const key = keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    header.alg !== "RS256" ||
    !key ||
    !["https://accounts.google.com", "accounts.google.com"].includes(
      String(claims.iss),
    ) ||
    !audience.includes(clientId) ||
    (audience.length > 1 && claims.azp !== clientId) ||
    claims.nonce !== nonce ||
    typeof claims.exp !== "number" ||
    claims.exp <= Date.now() / 1000 ||
    typeof claims.iat !== "number" ||
    claims.iat > Date.now() / 1000 + 60 ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    claims.email_verified !== true ||
    typeof claims.email !== "string" ||
    !(await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      await crypto.subtle.importKey(
        "jwk",
        key,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      ),
      unbase64url(parts[2], 512),
      encoder.encode(parts[0] + "." + parts[1]),
    ))
  )
    throw new SyncError(401, "INVALID_ID_TOKEN", "Google 身份校验未通过。");
  return {
    subject: claims.sub,
    name: typeof claims.name === "string" ? claims.name : claims.email,
    email: claims.email,
  };
}
export class ExternalLogins {
  readonly cipher: AccountCipher;
  constructor(
    readonly db: MetadataStore,
    readonly sessions: Sessions,
    readonly options: ExternalLoginOptions,
  ) {
    this.cipher = new AccountCipher(options.vaultKey);
  }
  get available() {
    return this.cipher.enabled
      ? [
          this.options.githubLogin && "github",
          this.options.googleLogin && "google",
          this.options.emailLogin && "email",
        ].filter((item): item is string => !!item)
      : [];
  }
  private context(id: string) {
    return `showai-login:${id}`;
  }
  async begin(
    input: Record<string, unknown>,
    base: string,
    source: string,
    link?: AccountSession,
  ) {
    const provider = plainText(input.provider, 30);
    if (!this.available.includes(provider))
      throw new SyncError(
        503,
        "LOGIN_NOT_CONFIGURED",
        "此服务尚未配置这种登录方式。",
      );
    await rateLimit(this.db, {
      scope: "external-login:start",
      identity: source,
      maximum: 20,
      windowMs: 60_000,
    });
    await this.db.run(
      "DELETE FROM login_flows WHERE id IN(SELECT id FROM login_flows WHERE expires_at<=? LIMIT 100)",
      [Date.now()],
    );
    const id = crypto.randomUUID(),
      state = token(),
      pollSecret = token(),
      verifier = token(),
      nonce = token();
    const expiresAt = Date.now() + (provider === "email" ? 300_000 : 600_000);
    const secret: FlowSecret = {
      verifier,
      nonce,
      redirectUri: serverEndpoint(base, `/api/auth/callback/${provider}`),
      device:
        typeof input.device === "string"
          ? plainText(input.device, 200)
          : "ShowAI",
      link,
      registrationKey:
        typeof input.registrationKey === "string"
          ? plainText(input.registrationKey, 200)
          : undefined,
    };
    let url: string | undefined, code: string | undefined;
    if (provider === "email") {
      const email = plainText(input.email, 254).toLowerCase();
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))
        throw new SyncError(400, "INVALID_EMAIL", "请输入有效的邮箱地址。");
      await rateLimit(this.db, {
        scope: "external-login:email",
        identity: email,
        maximum: 5,
        windowMs: 3600_000,
      });
      let random = crypto.getRandomValues(new Uint32Array(1))[0];
      while (random >= 4_200_000_000)
        random = crypto.getRandomValues(new Uint32Array(1))[0];
      code = String(random % 100_000_000).padStart(8, "0");
      secret.email = email;
      secret.codeDigest = await hash(`${id}:${code}`);
    } else {
      const config =
        provider === "github"
          ? this.options.githubLogin!
          : this.options.googleLogin!;
      const query = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: secret.redirectUri,
        state,
        scope:
          provider === "github"
            ? "read:user user:email"
            : "openid profile email",
        nonce,
        code_challenge_method: "S256",
        code_challenge: base64url(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", encoder.encode(verifier)),
          ),
        ),
      });
      if (provider === "google") query.set("prompt", "select_account");
      url =
        (provider === "github"
          ? "https://github.com/login/oauth/authorize"
          : "https://accounts.google.com/o/oauth2/v2/auth") +
        "?" +
        query;
    }
    await this.db.run(
      "INSERT INTO login_flows(id,provider,state_digest,poll_digest,expires_at,status,secret) VALUES(?,?,?,?,?,'pending',?)",
      [
        id,
        provider,
        await hash(state),
        await hash(pollSecret),
        expiresAt,
        await this.cipher.seal(this.context(id), secret),
      ],
    );
    if (code) {
      const email = this.options.emailLogin!;
      try {
        await providerJson("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${email.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: email.from,
            to: [secret.email],
            subject: "ShowAI 登录验证码",
            text: `你的 ShowAI 登录验证码是 ${code}，5 分钟内有效。\n\n登录服务：${base}\n如果不是你发起的登录，请忽略这封邮件。`,
          }),
        });
      } catch (error) {
        await this.db.run("DELETE FROM login_flows WHERE id=?", [id]);
        throw error;
      }
    }
    return { id, pollSecret, url, provider, expiresAt };
  }
  private async externalUser(
    provider: string,
    identity: ExternalIdentity,
    flow: FlowSecret,
  ): Promise<AuthUser> {
    const bound = (
      await this.db.all<{ user_id: string }>(
        "SELECT user_id FROM login_identities WHERE provider=? AND subject=?",
        [provider, identity.subject],
      )
    )[0];
    if (flow.link) {
      const permission = liveSession(flow.link);
      if (!(await this.db.all(permission.sql, permission.values)).length)
        throw new SyncError(
          401,
          "UNAUTHORIZED",
          "原账号登录已过期，请重新绑定。",
        );
      if (bound && bound.user_id !== flow.link.id)
        throw new SyncError(
          409,
          "LOGIN_ALREADY_BOUND",
          "这种登录方式已经绑定另一个账号。",
        );
      await this.db.run(
        `INSERT OR IGNORE INTO login_identities(provider,subject,user_id,email,created_at) SELECT ?,?,?,?,? WHERE EXISTS(${permission.sql})`,
        [
          provider,
          identity.subject,
          flow.link.id,
          identity.email ?? null,
          new Date().toISOString(),
          ...permission.values!,
        ],
      );
      const actual = (
        await this.db.all<{ user_id: string }>(
          "SELECT user_id FROM login_identities WHERE provider=? AND subject=?",
          [provider, identity.subject],
        )
      )[0];
      if (actual?.user_id !== flow.link.id)
        throw new SyncError(
          409,
          "LOGIN_ALREADY_BOUND",
          "登录绑定发生变化，请重试。",
        );
      return flow.link;
    }
    if (bound)
      return (
        await this.db.all<AuthUser>(
          "SELECT id,name,auth_version FROM users WHERE id=?",
          [bound.user_id],
        )
      )[0];
    if (
      this.options.registrationMode !== "open" &&
      (!this.options.registrationKey ||
        typeof flow.registrationKey !== "string" ||
        (await hash(flow.registrationKey)) !==
          (await hash(this.options.registrationKey)))
    )
      throw new SyncError(
        403,
        "REGISTRATION_KEY_REQUIRED",
        "新账号需要注册密钥；已有账号请使用原登录方式，再绑定此登录方式。",
      );
    const id = crypto.randomUUID(),
      salt = token(),
      password = await passwordHash(token(), salt),
      at = new Date().toISOString();
    const baseName =
      identity.name
        .replace(/[<>\r\n]/g, "")
        .slice(0, 80)
        .trim() || provider;
    const exists = (
      await this.db.all("SELECT 1 FROM users WHERE name=?", [baseName])
    ).length;
    const name = exists ? `${baseName} · ${id.slice(0, 8)}` : baseName;
    await this.db.batch([
      {
        sql: "INSERT OR IGNORE INTO users(id,name,password_salt,password_hash,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM login_identities WHERE provider=? AND subject=?) AND (SELECT COUNT(*) FROM users)<?",
        values: [
          id,
          name,
          salt,
          password,
          at,
          provider,
          identity.subject,
          this.options.accountLimit ?? 10000,
        ],
      },
      {
        sql: "INSERT OR IGNORE INTO login_identities(provider,subject,user_id,email,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=?)",
        values: [
          provider,
          identity.subject,
          id,
          identity.email ?? null,
          at,
          id,
        ],
      },
      audit(
        "account.external-register",
        id,
        null,
        { provider },
        { sql: "SELECT 1 FROM login_identities WHERE user_id=?", values: [id] },
      ),
    ]);
    const result = (
      await this.db.all<AuthUser>(
        "SELECT u.id,u.name,u.auth_version FROM login_identities i JOIN users u ON u.id=i.user_id WHERE i.provider=? AND i.subject=?",
        [provider, identity.subject],
      )
    )[0];
    if (!result)
      throw new SyncError(
        507,
        "ACCOUNT_CAPACITY",
        "注册未完成，服务容量已达上限或账号名已占用，请重试。",
      );
    return result;
  }
  async callback(provider: string, url: URL) {
    const state = plainText(url.searchParams.get("state"), 200);
    const row = (
      await this.db.all<FlowRow>(
        "SELECT * FROM login_flows WHERE provider=? AND state_digest=? AND expires_at>? AND status='pending'",
        [provider, await hash(state), Date.now()],
      )
    )[0];
    if (!row || !["github", "google"].includes(provider))
      throw new SyncError(
        401,
        "INVALID_LOGIN_STATE",
        "登录请求已过期或已使用。",
      );
    const claimed = await this.db.run(
      "UPDATE login_flows SET status='processing' WHERE id=? AND status='pending' AND expires_at>?",
      [row.id, Date.now()],
    );
    if (!claimed.changes)
      throw new SyncError(409, "LOGIN_ALREADY_USED", "登录请求已被处理。");
    const secret = await this.cipher.open<FlowSecret>(
      this.context(row.id),
      row.secret,
    );
    try {
      if (url.searchParams.has("error"))
        throw new SyncError(401, "LOGIN_CANCELLED", "登录授权已取消。");
      const config =
        provider === "github"
          ? this.options.githubLogin!
          : this.options.googleLogin!;
      const data = await providerJson(
        provider === "github"
          ? "https://github.com/login/oauth/access_token"
          : "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: { accept: "application/json" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code: plainText(url.searchParams.get("code"), 4096),
            code_verifier: secret.verifier,
            redirect_uri: secret.redirectUri,
          }),
        },
      );
      let identity: ExternalIdentity;
      if (provider === "github") {
        if (typeof data.access_token !== "string")
          throw new SyncError(
            401,
            "LOGIN_PROVIDER_FAILED",
            "GitHub 授权未完成。",
          );
        const headers = {
          authorization: `Bearer ${data.access_token}`,
          accept: "application/vnd.github+json",
          "user-agent": "ShowAI",
          "X-GitHub-Api-Version": "2022-11-28",
        };
        const profile = await providerJson("https://api.github.com/user", {
          headers,
        });
        if (
          !Number.isSafeInteger(profile.id) ||
          typeof profile.login !== "string"
        )
          throw new SyncError(401, "INVALID_ID_TOKEN", "GitHub 身份无效。");
        identity = { subject: String(profile.id), name: profile.login };
      } else {
        if (typeof data.id_token !== "string")
          throw new SyncError(
            401,
            "INVALID_ID_TOKEN",
            "Google 未返回身份凭据。",
          );
        const keys = await providerJson(
          "https://www.googleapis.com/oauth2/v3/certs",
        );
        identity = await googleIdentity(
          data.id_token,
          config.clientId,
          secret.nonce,
          keys.keys as (JsonWebKey & { kid?: string })[],
        );
      }
      if (secret.link) {
        const confirm = token();
        secret.externalIdentity = identity;
        secret.confirmDigest = await hash(confirm);
        await this.db.run(
          "UPDATE login_flows SET status='confirming',secret=? WHERE id=? AND status='processing'",
          [await this.cipher.seal(this.context(row.id), secret), row.id],
        );
        const escape = (value: string) =>
          value.replace(
            /[&<>"']/g,
            (character) =>
              ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
              })[character]!,
          );
        const endpoint = secret.redirectUri.replace(
          /\/callback\/(github|google)$/,
          "/confirm-link",
        );
        return new Response(
          `<!doctype html><html lang=zh><meta charset=utf-8><title>确认 ShowAI 登录绑定</title><body style='font:18px system-ui;max-width:600px;margin:12vh auto;padding:32px'><h1>确认添加登录方式</h1><p>将 ${escape(identity.email ?? identity.name)} 的 ${escape(provider)} 登录绑定到 ShowAI 账号「${escape(secret.link.name)}」。以后使用这份第三方账号会登录到该 ShowAI 账号。</p><button id=confirm>确认绑定</button><p id=result role=status></p><script>document.getElementById('confirm').onclick=async function(){this.disabled=true;const response=await fetch(${JSON.stringify(endpoint)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:${JSON.stringify(row.id)},confirmToken:${JSON.stringify(confirm)}})});document.getElementById('result').textContent=response.ok?'已绑定，请返回 ShowAI。':'绑定未完成，请返回 ShowAI 重试。';};</script></body></html>`,
          {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-store",
            },
          },
        );
      }
      secret.user = await this.externalUser(provider, identity, secret);
      await this.db.run(
        "UPDATE login_flows SET status='completed',secret=? WHERE id=? AND status='processing'",
        [await this.cipher.seal(this.context(row.id), secret), row.id],
      );
    } catch (error) {
      secret.error =
        error instanceof SyncError
          ? error.message
          : "登录未完成，请重新发起登录。";
      await this.db.run(
        "UPDATE login_flows SET status='failed',secret=? WHERE id=?",
        [await this.cipher.seal(this.context(row.id), secret), row.id],
      );
      throw error;
    }
    return new Response(
      "<!doctype html><html lang=zh><meta charset=utf-8><title>ShowAI 登录</title><body style='font:18px system-ui;padding:48px'><h1>已完成授权</h1><p>请返回发起登录的 ShowAI 窗口。</p></body></html>",
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }
  async confirmLink(input: Record<string, unknown>) {
    const id = plainText(input.id, 100),
      confirmation = await hash(plainText(input.confirmToken, 100));
    const row = (
      await this.db.all<FlowRow>(
        "SELECT * FROM login_flows WHERE id=? AND status='confirming' AND expires_at>?",
        [id, Date.now()],
      )
    )[0];
    if (!row)
      throw new SyncError(401, "LOGIN_EXPIRED", "绑定确认已过期或已使用。");
    const secret = await this.cipher.open<FlowSecret>(
      this.context(id),
      row.secret,
    );
    if (
      confirmation !== secret.confirmDigest ||
      !secret.link ||
      !secret.externalIdentity
    )
      throw new SyncError(401, "INVALID_LOGIN_CONFIRMATION", "绑定确认无效。");
    const acquired = await this.db.run(
      "UPDATE login_flows SET status='processing' WHERE id=? AND status='confirming' AND expires_at>?",
      [id, Date.now()],
    );
    if (!acquired.changes)
      throw new SyncError(409, "LOGIN_ALREADY_USED", "绑定确认已被处理。");
    secret.user = await this.externalUser(
      row.provider,
      secret.externalIdentity,
      secret,
    );
    await this.db.run(
      "UPDATE login_flows SET status='completed',secret=? WHERE id=? AND status='processing'",
      [await this.cipher.seal(this.context(id), secret), id],
    );
    return { ok: true };
  }
  async finish(input: Record<string, unknown>, source: string) {
    await rateLimit(this.db, {
      scope: "external-login:finish",
      identity: source,
      maximum: 120,
      windowMs: 60_000,
    });
    const id = plainText(input.id, 100),
      poll = await hash(plainText(input.pollSecret, 100));
    let row = (
      await this.db.all<FlowRow>(
        "SELECT * FROM login_flows WHERE id=? AND poll_digest=? AND expires_at>?",
        [id, poll, Date.now()],
      )
    )[0];
    if (!row)
      throw new SyncError(401, "LOGIN_EXPIRED", "登录请求已过期，请重新发起。");
    const secret = await this.cipher.open<FlowSecret>(
      this.context(id),
      row.secret,
    );
    if (
      row.provider === "email" &&
      row.status === "pending" &&
      input.code !== undefined
    ) {
      const code = plainText(input.code, 8);
      if (
        !/^\d{8}$/.test(code) ||
        row.claimed >= 5 ||
        (await hash(`${id}:${code}`)) !== secret.codeDigest
      ) {
        await this.db.run(
          "UPDATE login_flows SET claimed=claimed+1,status=CASE WHEN claimed>=4 THEN 'failed' ELSE status END WHERE id=? AND status='pending'",
          [id],
        );
        throw new SyncError(
          401,
          "INVALID_EMAIL_CODE",
          "验证码无效或尝试次数已达上限，请重新发起登录。",
        );
      }
      const acquired = await this.db.run(
        "UPDATE login_flows SET status='processing' WHERE id=? AND status='pending' AND claimed<5 AND expires_at>?",
        [id, Date.now()],
      );
      if (acquired.changes) {
        try {
          secret.user = await this.externalUser(
            "email",
            {
              subject: secret.email!,
              name: secret.email!,
              email: secret.email!,
            },
            secret,
          );
          await this.db.run(
            "UPDATE login_flows SET status='completed',secret=? WHERE id=? AND status='processing'",
            [await this.cipher.seal(this.context(id), secret), id],
          );
        } catch (error) {
          await this.db.run(
            "UPDATE login_flows SET status='failed' WHERE id=?",
            [id],
          );
          throw error;
        }
      }
      row = (
        await this.db.all<FlowRow>("SELECT * FROM login_flows WHERE id=?", [id])
      )[0];
    }
    if (row.status === "failed")
      throw new SyncError(
        401,
        "LOGIN_FAILED",
        secret.error ?? "登录未完成，请重新发起登录。",
      );
    if (row.status === "ready")
      return {
        status: "completed",
        ...(await this.cipher.open<FlowSecret>(this.context(id), row.secret))
          .result,
      };
    if (row.status !== "completed") return { status: "pending" };
    const acquired = await this.db.run(
      "UPDATE login_flows SET status='issuing' WHERE id=? AND status='completed' AND expires_at>?",
      [id, Date.now()],
    );
    if (!acquired.changes) return { status: "pending" };
    const completed = await this.cipher.open<FlowSecret>(
      this.context(id),
      row.secret,
    );
    if (!completed.user)
      throw new Error("Completed login is missing its account.");
    completed.result = await this.sessions.create(
      completed.user,
      completed.device,
      completed.link ? { condition: liveSession(completed.link) } : {},
    );
    await this.db.run(
      "UPDATE login_flows SET status='ready',secret=? WHERE id=? AND status='issuing'",
      [await this.cipher.seal(this.context(id), completed), id],
    );
    return { status: "completed", ...completed.result };
  }
}

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { syncProtocol, type SyncProject } from "../sync/protocol";

export interface ProjectGrant {
  id: string;
  clientId: string;
  serverUrl: string;
  serverId: string;
  user: { id: string; name: string };
  upstreamToken: string;
  projectIds: string[];
  /** Omitted on old grants, which remain limited to their selected projects. */
  projectAccess?: "selected" | "account";
  scopes: string[];
}
type Client = {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  secretHash?: string;
};
type Flow = {
  clientId: string;
  redirect: string;
  state?: string;
  challenge: string;
  scopes: string[];
  csrf: string;
  attempts: number;
  connection?: Omit<ProjectGrant, "id" | "clientId" | "projectIds" | "scopes">;
  projects?: SyncProject[];
  external?: {
    serverUrl: string;
    serverId: string;
    id: string;
    pollSecret: string;
    url: string;
  };
};
const token = () => randomBytes(32).toString("base64url");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
const escaped = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly code = "invalid_token",
    readonly status = 401,
  ) {
    super(message);
  }
}
const scopeNames = ["projects.read", "projects.write", "projects.create"];
function scopes(value: unknown) {
  const result =
    typeof value === "string" && value.trim()
      ? [...new Set(value.trim().split(/\s+/))]
      : ["projects.read"];
  if (result.some((scope) => !scopeNames.includes(scope)))
    throw new AuthorizationError("Unsupported scope.", "invalid_scope", 400);
  if (!result.includes("projects.read")) result.unshift("projects.read");
  return result;
}
function redirectUri(value: string) {
  const u = new URL(value);
  if (
    u.username ||
    u.password ||
    u.hash ||
    (u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
      ))
  )
    throw new AuthorizationError(
      "Use an HTTPS redirect URI or a native loopback callback.",
      "invalid_redirect_uri",
      400,
    );
  return u.href;
}
async function parameters(request: Request): Promise<Record<string, unknown>> {
  const body = await request.text();
  if (Buffer.byteLength(body) > 65536)
    throw new AuthorizationError(
      "Request is too large.",
      "invalid_request",
      413,
    );
  return request.headers.get("content-type")?.includes("application/json")
    ? JSON.parse(body)
    : Object.fromEntries(new URLSearchParams(body));
}
export async function upstream<T>(
  server: string,
  path: string,
  credential?: string,
  data?: unknown,
): Promise<T> {
  const response = await fetch(server + path, {
    method: data === undefined ? "GET" : "POST",
    redirect: "error",
    headers: {
      ...(credential ? { authorization: `Bearer ${credential}` } : {}),
      ...(data === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new AuthorizationError(
      result.error?.message ?? "ShowAI Server rejected the request.",
      response.status === 401
        ? "invalid_token"
        : response.status === 403
          ? "access_denied"
          : (result.error?.code ?? "upstream_error"),
      response.status,
    );
  return result as T;
}

/** OAuth authorization-code + S256 PKCE, backed by existing ShowAI Server accounts and explicit project consent. */
export class McpAuthorization {
  readonly resource: string;
  private constructor(
    readonly url: string,
    readonly servers: string[],
    private db: DatabaseSync,
  ) {
    this.resource = url + "/mcp";
  }
  static async open(home: string, url: string, servers: string[]) {
    await mkdir(home, { recursive: true, mode: 0o700 });
    const path = join(home, "authorization.sqlite");
    const db = new DatabaseSync(path);
    await chmod(path, 0o600);
    db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(kind,key));",
    );
    return new McpAuthorization(url, servers, db);
  }
  close() {
    this.db.close();
  }
  checkpoint() {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
  private get<T>(kind: string, key: string): T | undefined {
    const row = this.db
      .prepare("SELECT value FROM records WHERE kind=? AND key=? AND expires>?")
      .get(kind, key, Date.now()) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  private put(kind: string, key: string, value: unknown, ttl: number) {
    this.db.prepare("DELETE FROM records WHERE expires<=?").run(Date.now());
    this.db
      .prepare(
        "INSERT OR REPLACE INTO records(kind,key,value,expires) VALUES(?,?,?,?)",
      )
      .run(kind, key, JSON.stringify(value), Date.now() + ttl);
  }
  private remove(kind: string, key: string) {
    this.db
      .prepare("DELETE FROM records WHERE kind=? AND key=?")
      .run(kind, key);
  }
  private limit(kind: string, maximum: number) {
    const key = `${kind}:${Math.floor(Date.now() / 60_000)}`;
    const count = this.get<number>("rate", key) ?? 0;
    if (count >= maximum)
      throw new AuthorizationError(
        "Too many authorization requests. Retry in one minute.",
        "temporarily_unavailable",
        429,
      );
    this.put("rate", key, count + 1, 120_000);
  }
  verify(credential: string | undefined, needed?: string): ProjectGrant {
    if (!credential)
      throw new AuthorizationError(
        "Connect a ShowAI account to access private projects.",
      );
    const access = this.get<{
      grantId: string;
      clientId: string;
      scopes: string[];
    }>("access", hash(credential));
    const grant = access && this.get<ProjectGrant>("grant", access.grantId);
    if (!grant || grant.clientId !== access?.clientId)
      throw new AuthorizationError(
        "The connection expired or was revoked. Reconnect ShowAI.",
      );
    const allowed = access.scopes.filter((scope) =>
      grant.scopes.includes(scope),
    );
    if (needed && !allowed.includes(needed))
      throw new AuthorizationError(
        `Authorize ${needed} to perform this operation.`,
        "insufficient_scope",
        403,
      );
    return { ...grant, scopes: allowed };
  }
  challenge(needed = "projects.read") {
    return `Bearer resource_metadata="${this.url}/.well-known/oauth-protected-resource", scope="${needed}"`;
  }
  private validateResource(value: unknown) {
    if (value !== undefined && value !== this.resource)
      throw new AuthorizationError(
        "The resource does not match this MCP server.",
        "invalid_target",
        400,
      );
  }
  private authenticatedClient(
    request: Request,
    input: Record<string, unknown>,
  ): Client {
    let id = String(input.client_id ?? ""),
      secret = String(input.client_secret ?? "");
    const basic = request.headers.get("authorization")?.match(/^Basic (.+)$/i);
    if (basic) {
      const pair = Buffer.from(basic[1], "base64").toString("utf8");
      const separator = pair.indexOf(":");
      id = decodeURIComponent(pair.slice(0, separator));
      secret = decodeURIComponent(pair.slice(separator + 1));
    }
    const client = this.get<Client>("client", id);
    if (
      !client ||
      (client.secretHash && !same(hash(secret), client.secretHash))
    )
      throw new AuthorizationError(
        "Invalid OAuth client.",
        "invalid_client",
        401,
      );
    return client;
  }
  private issue(grant: ProjectGrant, grantedScopes = grant.scopes) {
    const accessToken = token(),
      refreshToken = token();
    this.put(
      "access",
      hash(accessToken),
      { grantId: grant.id, clientId: grant.clientId, scopes: grantedScopes },
      60 * 60_000,
    );
    this.put(
      "refresh",
      hash(refreshToken),
      { grantId: grant.id, clientId: grant.clientId, scopes: grantedScopes },
      30 * 86400_000,
    );
    return json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: grantedScopes.join(" "),
    });
  }
  private form(flowId: string, flow: Flow, error = "") {
    const hidden = `<input type="hidden" name="flow" value="${escaped(flowId)}"><input type="hidden" name="csrf" value="${escaped(flow.csrf)}">`;
    const client = this.get<Client>("client", flow.clientId)!;
    const content = flow.connection
      ? `<p>${escaped(client.client_name || "Agent")} 请求访问服务器上的 ShowAI 账号 <strong>${escaped(flow.connection.user.name)}</strong>。</p><p>${flow.scopes.includes("projects.write") ? "可读取及编辑；每次操作都检查最新项目成员权限。" : "只允许读取。"}${flow.scopes.includes("projects.create") ? "包含新建项目。" : ""}</p><form method="post" action="${this.url}/oauth/consent">${hidden}<label><input type="radio" name="access" value="account" checked>授权这个账号当前及今后有权限的所有项目</label><p>以后从本地同步到此账号的项目也会进入授权范围。可以随时在 ChatGPT 断开连接。</p><label><input type="radio" name="access" value="selected">仅授权一个项目<select name="project"><option value="">请选择</option>${(
          flow.projects ?? []
        )
          .filter((p) => !p.archived)
          .map(
            (p) =>
              `<option value="${escaped(p.id)}">${escaped(p.name)} · ${escaped(p.role)}</option>`,
          )
          .join(
            "",
          )}</select></label><button name="decision" value="allow">确认授权</button><button name="decision" value="deny" class="secondary">取消</button></form>`
      : flow.external
        ? `<p>打开登录页面完成验证。页面最后会显示一个 8 位完成码，把它填到这里继续。已有账号需要先在 ShowAI 中绑定该登录方式。</p><a href="${escaped(flow.external.url)}" target="_blank" rel="noopener noreferrer">打开登录页面</a><form method="post" action="${this.url}/oauth/external/finish">${hidden}<label>完成码<input name="completionCode" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="12" placeholder="XXXX-XXXX"></label><button>继续</button><button name="restart" value="1" class="secondary">重新选择登录方式</button></form>`
        : `<p>公开组件、模板和展示无需登录。访问私有项目时，使用你已有的 ShowAI Server 账号。</p><form method="post" action="${this.url}/oauth/login">${hidden}<label>服务器<select name="server" required>${this.servers.map((s) => `<option value="${escaped(s)}">${escaped(s)}</option>`).join("")}</select></label><button formaction="${this.url}/oauth/external/start" name="provider" value="github">使用 GitHub 登录</button><button formaction="${this.url}/oauth/external/start" name="provider" value="google">使用 Google 登录</button><label>账号<input name="account" autocomplete="username" maxlength="100"></label><label>密码<input name="password" type="password" autocomplete="current-password"></label><button>使用账号密码登录</button></form>`;
    return new Response(
      `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>连接 ShowAI</title><style>body{font:16px/1.6 system-ui;max-width:520px;margin:8vh auto;padding:24px;color:#173341;background:#f9fbfc}h1{font-size:30px}label{display:block;margin:18px 0}input,select{display:block;box-sizing:border-box;width:100%;padding:12px;margin-top:5px;border:1px solid #aebdc5;border-radius:5px;font:inherit}button{padding:12px 20px;border:0;border-radius:5px;background:#075e7c;color:white;font:inherit;margin-right:12px}.secondary{background:#e5edf1;color:#173341}.error{color:#a42e29}</style><h1>连接 ShowAI</h1>${error ? `<p class="error" role="alert">${escaped(error)}</p>` : ""}${content}</html>`,
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          // Same-origin keeps the real Origin on these form posts (no-referrer
          // makes browsers send Origin: null) without leaking a Referer elsewhere.
          "referrer-policy": "same-origin",
          // form-action also governs the redirect after consent, so allow the
          // client's registered redirect origin alongside this page.
          "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(flow.redirect).origin}; frame-ancestors 'none'`,
          "set-cookie": `showai_oauth=${flowId}; Path=/oauth; HttpOnly; SameSite=Lax; Max-Age=600${this.url.startsWith("https:") ? "; Secure" : ""}`,
        },
      },
    );
  }
  async fetch(request: Request): Promise<Response | null> {
    const url = new URL(request.url),
      path = url.pathname;
    if (
      path === "/.well-known/oauth-protected-resource" ||
      path === "/.well-known/oauth-protected-resource/mcp"
    )
      return json({
        resource: this.resource,
        authorization_servers: [this.url],
        scopes_supported: scopeNames,
      });
    if (path === "/.well-known/oauth-authorization-server")
      return json({
        issuer: this.url,
        authorization_endpoint: this.url + "/oauth/authorize",
        token_endpoint: this.url + "/oauth/token",
        registration_endpoint: this.url + "/oauth/register",
        revocation_endpoint: this.url + "/oauth/revoke",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: [
          "none",
          "client_secret_post",
          "client_secret_basic",
        ],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: scopeNames,
        authorization_response_iss_parameter_supported: true,
      });
    if (!path.startsWith("/oauth/")) return null;
    try {
      if (path === "/oauth/register" && request.method === "POST") {
        this.limit("registration", 60);
        const input = await parameters(request);
        if (
          !Array.isArray(input.redirect_uris) ||
          !input.redirect_uris.length ||
          input.redirect_uris.length > 10 ||
          input.redirect_uris.some((v) => typeof v !== "string")
        )
          throw new AuthorizationError(
            "Provide redirect_uris.",
            "invalid_client_metadata",
            400,
          );
        const method = String(input.token_endpoint_auth_method ?? "none");
        if (
          !["none", "client_secret_post", "client_secret_basic"].includes(
            method,
          )
        )
          throw new AuthorizationError(
            "Unsupported client authentication method.",
            "invalid_client_metadata",
            400,
          );
        const client: Client = {
          client_id: token(),
          client_name:
            typeof input.client_name === "string"
              ? input.client_name.slice(0, 100)
              : "Agent",
          redirect_uris: input.redirect_uris.map((v) =>
            redirectUri(v as string),
          ),
          token_endpoint_auth_method: method,
        };
        const secret = method === "none" ? undefined : token();
        if (secret) client.secretHash = hash(secret);
        this.put("client", client.client_id, client, 10 * 365 * 86400_000);
        const { secretHash: _secretHash, ...publicClient } = client;
        return json(
          {
            ...publicClient,
            ...(secret
              ? { client_secret: secret, client_secret_expires_at: 0 }
              : {}),
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
          },
          201,
        );
      }
      if (path === "/oauth/authorize" && request.method === "GET") {
        this.limit("authorization", 120);
        const q = url.searchParams;
        const client = this.get<Client>("client", q.get("client_id") ?? "");
        const redirect = q.get("redirect_uri") ?? "";
        if (!client || !client.redirect_uris.includes(redirect))
          throw new AuthorizationError(
            "Unknown client or redirect URI.",
            "invalid_request",
            400,
          );
        if (
          q.get("response_type") !== "code" ||
          q.get("code_challenge_method") !== "S256" ||
          !/^[A-Za-z0-9_-]{43}$/.test(q.get("code_challenge") ?? "")
        )
          throw new AuthorizationError(
            "Authorization code and S256 PKCE are required.",
            "invalid_request",
            400,
          );
        this.validateResource(q.get("resource") ?? undefined);
        if (!this.servers.length)
          throw new AuthorizationError(
            "This deployment provides public presentation only. Configure a ShowAI sync server to enable private projects.",
            "temporarily_unavailable",
            503,
          );
        const id = token(),
          flow: Flow = {
            clientId: client.client_id,
            redirect,
            state: q.get("state") ?? undefined,
            challenge: q.get("code_challenge")!,
            scopes: scopes(q.get("scope")),
            csrf: token(),
            attempts: 0,
          };
        this.put("flow", id, flow, 10 * 60_000);
        return this.form(id, flow);
      }
      if (
        [
          "/oauth/login",
          "/oauth/consent",
          "/oauth/external/start",
          "/oauth/external/finish",
        ].includes(path) &&
        request.method === "POST"
      ) {
        const input = await parameters(request),
          flowId = String(input.flow ?? ""),
          flow = this.get<Flow>("flow", flowId);
        const cookie = request.headers
          .get("cookie")
          ?.split(/;\s*/)
          .find((c) => c.startsWith("showai_oauth="))
          ?.slice(13);
        if (
          !flow ||
          !same(String(input.csrf ?? ""), flow.csrf) ||
          cookie !== flowId ||
          (request.headers.has("origin") &&
            request.headers.get("origin") !== this.url)
        )
          throw new AuthorizationError(
            "The authorization form expired. Start the connection again.",
            "invalid_request",
            400,
          );
        if (
          path === "/oauth/external/start" ||
          path === "/oauth/external/finish"
        ) {
          this.limit("external-login", 30);
          if (++flow.attempts > 10)
            throw new AuthorizationError(
              "Too many login attempts. Start again.",
              "access_denied",
              429,
            );
          this.put("flow", flowId, flow, 10 * 60_000);
          try {
            if (path.endsWith("/start")) {
              const server = String(input.server ?? ""),
                provider = String(input.provider ?? "");
              if (
                !this.servers.includes(server) ||
                !["github", "google"].includes(provider)
              )
                throw new AuthorizationError(
                  "Choose a configured server and login provider.",
                  "invalid_request",
                  400,
                );
              const info = await upstream<{
                protocol: string;
                serverId: string;
                auth: string[];
              }>(server, "/api/info");
              if (
                info.protocol !== syncProtocol ||
                !info.auth.includes(provider)
              )
                throw new AuthorizationError(
                  "此服务器尚未启用这种登录方式。请使用账号密码，或联系管理员配置。",
                  "temporarily_unavailable",
                  503,
                );
              const started = await upstream<{
                id: string;
                pollSecret: string;
                url: string;
              }>(server, "/api/auth/start", undefined, {
                provider,
                device: "ShowAI MCP",
              });
              const providerUrl = new URL(started.url);
              const expectedHost =
                provider === "github" ? "github.com" : "accounts.google.com";
              if (
                providerUrl.protocol !== "https:" ||
                providerUrl.hostname !== expectedHost
              )
                throw new AuthorizationError(
                  "Invalid login provider URL.",
                  "invalid_request",
                  400,
                );
              flow.external = {
                serverUrl: server,
                serverId: info.serverId,
                ...started,
              };
            } else {
              const external = flow.external;
              if (!external)
                throw new AuthorizationError(
                  "Restart the login flow.",
                  "invalid_request",
                  400,
                );
              if (input.restart) {
                delete flow.external;
                this.put("flow", flowId, flow, 10 * 60_000);
                return this.form(flowId, flow);
              }
              // The server binds provider logins to this window with a one-time
              // completion code; an empty field only checks status so it never
              // spends one of the server's limited code attempts.
              const completionCode = String(input.completionCode ?? "").trim();
              const result = await upstream<{
                status?: string;
                serverId?: string;
                user?: ProjectGrant["user"];
                token?: string;
              }>(external.serverUrl, "/api/auth/finish", undefined, {
                id: external.id,
                pollSecret: external.pollSecret,
                ...(completionCode ? { completionCode } : {}),
              });
              if (!result.token || !result.user)
                return this.form(
                  flowId,
                  flow,
                  result.status === "confirm"
                    ? "请输入登录页面显示的完成码。"
                    : "登录尚未完成，请完成登录后再继续。",
                );
              if (result.serverId !== external.serverId)
                throw new AuthorizationError(
                  "Server identity changed during login.",
                  "access_denied",
                  403,
                );
              flow.connection = {
                serverUrl: external.serverUrl,
                serverId: external.serverId,
                user: result.user,
                upstreamToken: result.token,
              };
              flow.projects = await upstream<SyncProject[]>(
                external.serverUrl,
                "/api/projects",
                result.token,
              );
              delete flow.external;
            }
            this.put("flow", flowId, flow, 10 * 60_000);
            return this.form(flowId, flow);
          } catch (error) {
            return this.form(
              flowId,
              flow,
              error instanceof Error ? error.message : "Login failed.",
            );
          }
        }
        if (path === "/oauth/login") {
          this.limit("login", 30);
          if (++flow.attempts > 5) {
            this.remove("flow", flowId);
            throw new AuthorizationError(
              "Too many login attempts. Start a new connection.",
              "access_denied",
              429,
            );
          }
          this.put("flow", flowId, flow, 10 * 60_000);
          const server = String(input.server ?? "");
          if (!this.servers.includes(server))
            throw new AuthorizationError(
              "Choose a configured server.",
              "invalid_request",
              400,
            );
          try {
            const info = await upstream<{ protocol: string; serverId: string }>(
              server,
              "/api/info",
            );
            if (info.protocol !== syncProtocol)
              throw new Error(
                "The selected server uses an incompatible ShowAI protocol.",
              );
            const login = await upstream<{
              serverId: string;
              user: ProjectGrant["user"];
              token: string;
            }>(server, "/api/auth/login", undefined, {
              name: String(input.account ?? ""),
              password: String(input.password ?? ""),
              device: "ShowAI MCP",
            });
            if (login.serverId !== info.serverId)
              throw new Error("Server identity changed during login.");
            flow.connection = {
              serverUrl: server,
              serverId: info.serverId,
              user: login.user,
              upstreamToken: login.token,
            };
            flow.projects = await upstream<SyncProject[]>(
              server,
              "/api/projects",
              login.token,
            );
            this.put("flow", flowId, flow, 10 * 60_000);
            return this.form(flowId, flow);
          } catch (error) {
            return this.form(
              flowId,
              flow,
              error instanceof Error ? error.message : "Login failed.",
            );
          }
        }
        const target = new URL(flow.redirect);
        if (flow.state) target.searchParams.set("state", flow.state);
        target.searchParams.set("iss", this.url);
        if (input.decision !== "allow")
          target.searchParams.set("error", "access_denied");
        else {
          if (!flow.connection)
            throw new AuthorizationError(
              "Sign in first.",
              "invalid_request",
              400,
            );
          const projectId = String(input.project ?? "");
          const projectAccess =
            input.access === "account" ? "account" : "selected";
          const projects = await upstream<SyncProject[]>(
            flow.connection.serverUrl,
            "/api/projects",
            flow.connection.upstreamToken,
          );
          const project = projects.find(
            (p) => p.id === projectId && !p.archived,
          );
          if (
            projectAccess === "selected" &&
            (!project ||
              (flow.scopes.includes("projects.write") &&
                project.role === "viewer") ||
              flow.scopes.includes("projects.create"))
          )
            throw new AuthorizationError(
              "Select account authorization to create projects, or choose a project with the requested permissions.",
              "access_denied",
              403,
            );
          const grant: ProjectGrant = {
            ...flow.connection,
            id: token(),
            clientId: flow.clientId,
            projectAccess,
            projectIds: projectAccess === "account" ? [] : [projectId],
            scopes: flow.scopes,
          };
          this.put("grant", grant.id, grant, 180 * 86400_000);
          const code = token();
          this.put(
            "code",
            hash(code),
            {
              grantId: grant.id,
              clientId: flow.clientId,
              redirect: flow.redirect,
              challenge: flow.challenge,
            },
            5 * 60_000,
          );
          target.searchParams.set("code", code);
        }
        this.remove("flow", flowId);
        return new Response(null, {
          status: 302,
          headers: { location: target.href, "cache-control": "no-store" },
        });
      }
      if (path === "/oauth/token" && request.method === "POST") {
        const input = await parameters(request),
          client = this.authenticatedClient(request, input);
        this.validateResource(input.resource);
        if (input.grant_type === "authorization_code") {
          const key = hash(String(input.code ?? "")),
            code = this.get<{
              grantId: string;
              clientId: string;
              redirect: string;
              challenge: string;
            }>("code", key);
          const verifier = String(input.code_verifier ?? "");
          const challenge = createHash("sha256")
            .update(verifier)
            .digest("base64url");
          if (
            !code ||
            code.clientId !== client.client_id ||
            input.redirect_uri !== code.redirect ||
            !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
            !same(challenge, code.challenge)
          )
            throw new AuthorizationError(
              "Invalid or expired authorization code.",
              "invalid_grant",
              400,
            );
          const grant = this.get<ProjectGrant>("grant", code.grantId);
          if (!grant)
            throw new AuthorizationError(
              "Authorization was revoked.",
              "invalid_grant",
              400,
            );
          this.remove("code", key);
          return this.issue(grant);
        }
        if (input.grant_type === "refresh_token") {
          const key = hash(String(input.refresh_token ?? "")),
            refresh = this.get<{
              grantId: string;
              clientId: string;
              scopes: string[];
            }>("refresh", key);
          const grant =
            refresh && this.get<ProjectGrant>("grant", refresh.grantId);
          if (!grant || refresh?.clientId !== client.client_id)
            throw new AuthorizationError(
              "Invalid refresh token.",
              "invalid_grant",
              400,
            );
          const nextScopes = input.scope ? scopes(input.scope) : refresh.scopes;
          if (
            nextScopes.some(
              (scope) =>
                !grant.scopes.includes(scope) ||
                !refresh.scopes.includes(scope),
            )
          )
            throw new AuthorizationError(
              "Refresh cannot expand scopes.",
              "invalid_scope",
              400,
            );
          this.remove("refresh", key);
          return this.issue(grant, nextScopes);
        }
        throw new AuthorizationError(
          "Unsupported grant type.",
          "unsupported_grant_type",
          400,
        );
      }
      if (path === "/oauth/revoke" && request.method === "POST") {
        const input = await parameters(request),
          client = this.authenticatedClient(request, input),
          key = hash(String(input.token ?? ""));
        const value =
          this.get<{ grantId: string; clientId: string }>("access", key) ??
          this.get<{ grantId: string; clientId: string }>("refresh", key);
        if (value?.clientId === client.client_id)
          this.remove("grant", value.grantId);
        return json({});
      }
      return json({ error: "invalid_request" }, 405);
    } catch (error) {
      if (
        !(error instanceof AuthorizationError) &&
        !(error instanceof SyntaxError) &&
        !(error instanceof TypeError)
      )
        throw error;
      return json(
        {
          error:
            error instanceof AuthorizationError
              ? error.code
              : "invalid_request",
          error_description: error.message,
        },
        error instanceof AuthorizationError ? error.status : 400,
      );
    }
  }
}

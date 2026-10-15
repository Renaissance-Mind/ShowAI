import {
  createServer,
  type Server,
  type RequestListener,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  createHash,
  randomBytes,
  randomUUID,
  createPublicKey,
  verify,
} from "node:crypto";
import { join } from "node:path";
import { withLibraryLock } from "../core/library-lock";
import {
  readOptional,
  writeProtected,
  type HostedCredentialBroker,
} from "./storage";
import { translator, getLocale } from "../i18n";
import agentHostMessages from "../i18n/messages/agentHost";

const t = translator(agentHostMessages);

const issuer = "https://auth.openai.com",
  resource = "https://api.openai.com/v1";
const requiredScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  "chatgpt.tokens.use.direct",
];
type IdentityKey = JsonWebKey & { kid?: string };
export interface ChatGptCredentials {
  refreshOwner: "local";
  clientId: string;
  subject: string;
  email: string;
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  expiresAt: number;
  scopes: string[];
}
export interface RemoteChatGptCredentials {
  refreshOwner: "server";
  connectionId: string;
  email: string;
}
type SavedCredentials = ChatGptCredentials | RemoteChatGptCredentials;
export function verifyIdToken(
  token: string,
  jwks: { keys: IdentityKey[] },
  clientId: string,
  nonce: string,
) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid OpenAI identity token.");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  const key = jwks.keys.find(
    (key) => key.kid === header.kid && key.kty === "RSA",
  );
  if (
    header.alg !== "RS256" ||
    !key ||
    !verify(
      "RSA-SHA256",
      Buffer.from(parts[0] + "." + parts[1]),
      createPublicKey({ key, format: "jwk" }),
      Buffer.from(parts[2], "base64url"),
    )
  )
    throw new Error("OpenAI identity signature verification failed.");
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (
    payload.iss !== issuer ||
    !audience.includes(clientId) ||
    payload.nonce !== nonce ||
    typeof payload.exp !== "number" ||
    payload.exp <= Date.now() / 1000 ||
    typeof payload.sub !== "string"
  )
    throw new Error("OpenAI identity claims verification failed.");
  return {
    subject: payload.sub as string,
    email:
      typeof payload.email === "string"
        ? payload.email
        : (payload.sub as string),
  };
}
async function tokenRequest(params: URLSearchParams) {
  const response = await fetch(issuer + "/api/accounts/oauth/token", {
    method: "POST",
    body: params,
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  const data = (await response.json()) as Record<string, any>;
  if (!response.ok || typeof data.access_token !== "string")
    throw new Error(
      t("chatgpt.authFailed", {
        reason: data.error_description ?? data.error ?? response.status,
      }),
    );
  return data;
}
export class ChatGptConnection {
  state: {
    state: "idle" | "pending" | "completed" | "failed";
    error?: string;
  } = { state: "idle" };
  private listener?: Server;
  private callback?: RequestListener;
  private timeout?: ReturnType<typeof setTimeout>;
  private refreshing = new Map<string, Promise<string>>();
  constructor(
    readonly root: string,
    readonly broker?: HostedCredentialBroker,
    readonly redirectUrl?: string,
    readonly afterAuthorization?: () => Promise<void>,
  ) {}
  private path(id: string) {
    return join(this.root, "credentials", id + ".json");
  }
  async credentials(id: string) {
    return readOptional<SavedCredentials>(this.path(id));
  }
  async start(id: string) {
    if (this.callback) throw new Error(t("chatgpt.inProgress"));
    const saved = await this.credentials(id);
    if (saved?.refreshOwner === "server")
      throw new Error(t("chatgpt.serverManaged"));
    let host = await readOptional<{ id: string }>(
      join(this.root, "chatgpt-host.json"),
    );
    if (!host) {
      host = { id: "urn:uuid:" + randomUUID() };
      await writeProtected(join(this.root, "chatgpt-host.json"), host);
    }
    const state = randomBytes(32).toString("base64url"),
      nonce = randomBytes(32).toString("base64url"),
      verifier = randomBytes(48).toString("base64url");
    let redirectUri = "",
      used = false;
    this.state = { state: "pending" };
    this.callback = (request, response) => {
      const callback = new URL(request.url ?? "/", redirectUri);
      if (
        request.method !== "GET" ||
        callback.pathname !== new URL(redirectUri).pathname
      ) {
        response.writeHead(404);
        response.end();
        return;
      }
      if (used || callback.searchParams.get("state") !== state) {
        response.writeHead(400);
        response.end("Invalid authorization state.");
        return;
      }
      used = true;
      const complete = async () => {
        const error = callback.searchParams.get("error");
        if (error)
          throw new Error(
            error === "access_denied"
              ? t("chatgpt.cancelled")
              : `ChatGPT authorization failed: ${error}`,
          );
        const code = callback.searchParams.get("code"),
          clientId = callback.searchParams.get("client_id") ?? saved?.clientId;
        if (
          !code ||
          !clientId ||
          clientId === "dynamic_agent_client" ||
          (saved && clientId !== saved.clientId)
        )
          throw new Error("ChatGPT returned an invalid registration.");
        const data = await tokenRequest(
          new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            code,
            code_verifier: verifier,
            redirect_uri: redirectUri,
            resource,
          }),
        );
        if (typeof data.id_token !== "string")
          throw new Error("Missing ChatGPT identity token.");
        const keyResponse = await fetch(issuer + "/.well-known/jwks.json", {
          signal: AbortSignal.timeout(30000),
        });
        if (!keyResponse.ok)
          throw new Error("Unable to retrieve OpenAI identity keys.");
        const identity = verifyIdToken(
          data.id_token,
          (await keyResponse.json()) as { keys: IdentityKey[] },
          clientId,
          nonce,
        );
        if (saved && saved.subject !== identity.subject)
          throw new Error(t("chatgpt.accountMismatch"));
        const credentials: ChatGptCredentials = {
          refreshOwner: "local",
          clientId,
          ...identity,
          idToken: data.id_token,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          scopes: String(data.scope ?? "")
            .split(/\s+/)
            .filter(Boolean),
          expiresAt: Date.now() + Number(data.expires_in) * 1000,
        };
        if (!Number.isFinite(credentials.expiresAt))
          throw new Error("Missing token expiration.");
        await writeProtected(this.path(id), credentials);
        await this.afterAuthorization?.();
        this.state = { state: "completed" };
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "content-security-policy":
            "default-src 'none'; style-src 'unsafe-inline'",
        });
        response.end(
          `<!doctype html><html lang=${getLocale()}><meta charset=utf-8><title>ShowAI</title><body style='font:18px system-ui;padding:48px'><h1>${t("chatgpt.connectedTitle")}</h1><p>${t("chatgpt.connectedBody")}</p></body></html>`,
        );
      };
      void complete()
        .catch((error: Error) => {
          this.state = { state: "failed", error: error.message };
          response.writeHead(400, {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          });
          response.end(t("chatgpt.callbackFailed"));
        })
        .finally(() => this.close());
    };
    if (!this.redirectUrl) {
      this.listener = createServer(this.callback);
      await new Promise<void>((resolve, reject) => {
        this.listener!.once("error", reject);
        this.listener!.listen(0, "127.0.0.1", resolve);
      });
    }
    const address = this.listener?.address();
    if (!this.redirectUrl && (!address || typeof address === "string"))
      throw new Error("Missing OAuth callback address.");
    redirectUri =
      this.redirectUrl ??
      `http://127.0.0.1:${(address as { port: number }).port}/auth/callback`;
    this.timeout = setTimeout(
      () => {
        this.state = { state: "failed", error: t("chatgpt.timedOut") };
        this.close();
      },
      15 * 60 * 1000,
    );
    const query = new URLSearchParams({
      client_id: saved?.clientId ?? "dynamic_agent_client",
      ext_agent_host_id: host.id,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: requiredScopes.join(" "),
      resource,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    });
    if (saved) {
      query.set("id_token_hint", saved.idToken);
      query.set("login_hint", saved.email);
    } else query.set("agent_name_hint", "ShowAI");
    return { url: issuer + "/api/accounts/authorize?" + query };
  }
  cancel() {
    this.close();
    this.state = { state: "idle" };
  }
  close() {
    clearTimeout(this.timeout);
    this.listener?.close();
    this.listener = undefined;
    this.callback = undefined;
  }
  handleCallback(request: IncomingMessage, response: ServerResponse) {
    if (!this.callback) {
      response.writeHead(410);
      response.end("Authorization expired. Start again in ShowAI.");
      return;
    }
    this.callback(request, response);
  }
  async accessToken(id: string, force = false): Promise<string> {
    const saved = await this.credentials(id);
    if (!saved) throw new Error(t("chatgpt.connectFirst"));
    if (saved.refreshOwner === "server") {
      if (!this.broker) throw new Error(t("credentials.notConnected"));
      return (await this.broker.accessToken(saved.connectionId, force)).token;
    }
    if (!saved.scopes.includes("chatgpt.tokens.use.direct"))
      throw new Error(t("chatgpt.reauthorizePlan"));
    if (!force && saved.expiresAt > Date.now() + 60000)
      return saved.accessToken;
    let active = this.refreshing.get(id);
    if (!active) {
      active = this.refresh(id, saved).finally(() =>
        this.refreshing.delete(id),
      );
      this.refreshing.set(id, active);
    }
    return active;
  }
  private async refresh(id: string, saved: ChatGptCredentials) {
    return withLibraryLock(
      this.root,
      async () => {
        const latest = await this.credentials(id);
        if (!latest) throw new Error(t("chatgpt.disconnected"));
        if (latest.refreshOwner === "server") {
          if (!this.broker) throw new Error(t("credentials.notConnected"));
          return (await this.broker.accessToken(latest.connectionId)).token;
        }
        if (
          latest.accessToken !== saved.accessToken &&
          latest.expiresAt > Date.now() + 60000
        )
          return latest.accessToken;
        saved = latest;
        if (!saved.refreshToken) throw new Error(t("chatgpt.expired"));
        const data = await tokenRequest(
          new URLSearchParams({
            grant_type: "refresh_token",
            client_id: saved.clientId,
            refresh_token: saved.refreshToken,
            resource,
          }),
        );
        const expiresAt = Date.now() + Number(data.expires_in) * 1000;
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
          throw new Error("ChatGPT returned an invalid token expiration.");
        await writeProtected(this.path(id), {
          ...saved,
          accessToken: data.access_token,
          refreshToken: data.refresh_token ?? saved.refreshToken,
          idToken: data.id_token ?? saved.idToken,
          scopes: data.scope ? String(data.scope).split(/\s+/) : saved.scopes,
          expiresAt,
        });
        return data.access_token as string;
      },
      "chatgpt-refresh",
    );
  }
  async disconnect(id: string) {
    const saved = await this.credentials(id);
    if (!saved) return;
    if (saved.refreshOwner === "server") {
      if (!this.broker) throw new Error(t("credentials.notConnected"));
      await this.broker.disconnect(saved.connectionId);
    } else if (saved.refreshToken) {
      const discovery = await fetch(
        issuer + "/.well-known/openid-configuration",
        { signal: AbortSignal.timeout(30000) },
      );
      if (!discovery.ok) throw new Error(t("chatgpt.revocationUnavailable"));
      const document = (await discovery.json()) as {
        revocation_endpoint?: string;
      };
      if (
        !document.revocation_endpoint ||
        new URL(document.revocation_endpoint).origin !== issuer
      )
        throw new Error("Invalid revocation endpoint.");
      const response = await fetch(document.revocation_endpoint, {
        method: "POST",
        body: new URLSearchParams({
          client_id: saved.clientId,
          token: saved.refreshToken,
          token_type_hint: "refresh_token",
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok)
        throw new Error(t("chatgpt.revokeFailed", { status: response.status }));
    }
    await writeProtected(this.path(id), null);
  }
}

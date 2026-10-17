import { DurableObject } from "cloudflare:workers";
import {
  invocation,
  remoteTaskActions,
} from "../../src/agent-host/remote-protocol.ts";

const json = (value, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
async function derived(key, value) {
  const secret = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.sign("HMAC", secret, new TextEncoder().encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function identity(input, env) {
  const serverUrl = String(input.serverUrl ?? "").replace(/\/$/, "");
  if (
    !(env.SHOWAI_AGENT_SYNC_SERVERS ?? "").split(",").includes(serverUrl) ||
    typeof input.token !== "string" ||
    input.token.length > 16000
  )
    throw new Error("The content server or session is not authorized.");
  const identityRequest = new Request(serverUrl + "/api/me", {
    headers: { authorization: `Bearer ${input.token}` },
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  const response =
    env.CONTENT_SERVER && serverUrl === env.SHOWAI_AGENT_SYNC_SERVICE_URL
      ? await env.CONTENT_SERVER.fetch(identityRequest)
      : await fetch(identityRequest);
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    const error = new Error(
      details.error?.message ??
        `Content server request failed (${response.status}).`,
    );
    error.status = response.status;
    error.code = details.error?.code;
    error.retryAfter = response.headers.get("retry-after");
    throw error;
  }
  const me = await response.json();
  if (!me.user?.id || !me.serverId) throw new Error("Invalid server identity.");
  const tenant = await derived(
    env.SHOWAI_AGENT_KEY,
    `${me.serverId}/${me.user.id}`,
  );
  return {
    tenant,
    actor: {
      serverUrl,
      token: input.token,
      serverId: me.serverId,
      userId: me.user.id,
    },
  };
}
async function state(request, env, tenant, name) {
  if (
    request.headers.get("authorization") !==
    `Bearer ${await derived(env.SHOWAI_AGENT_KEY, tenant)}`
  )
    return new Response(null, { status: 404 });
  const key = `agent-state/${tenant}/${name}`;
  if (request.method === "GET") {
    const object = await env.STATE.get(key);
    return object
      ? new Response(object.body)
      : new Response(null, { status: 404 });
  }
  if (request.method === "PUT") {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 16 * 1024 * 1024)
      return new Response(null, { status: 413 });
    await env.STATE.put(key, bytes);
    return new Response(null, { status: 204 });
  }
  return new Response(null, { status: 405 });
}
export class ShowAIAgentGateway extends DurableObject {
  pending = new Map();
  async fetch(request) {
    const url = new URL(request.url);
    const tenant = request.headers.get("x-showai-tenant");
    if (tenant) await this.ctx.storage.put("tenant", tenant);
    if (url.pathname.startsWith("/activity/")) {
      await this.ctx.container.setInactivityTimeout(15 * 60 * 1000);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/devices/ticket") {
      const input = await request.json();
      if (
        !/^[a-f0-9-]{36}$/.test(input.deviceId) ||
        !Array.isArray(input.projectIds) ||
        input.projectIds.length > 1000 ||
        input.projectIds.some((id) => !/^[\w-]{1,200}$/.test(id))
      )
        return json(
          { error: { message: "Invalid device registration." } },
          400,
        );
      const ticket = crypto.randomUUID();
      await this.ctx.storage.put(`ticket:${ticket}`, {
        id: input.deviceId,
        name: String(input.name).slice(0, 100),
        projectIds: input.projectIds,
        expires: Date.now() + 60000,
      });
      return json({ ticket, tenant });
    }
    if (url.pathname.startsWith("/devices/connect/")) {
      const ticket = url.searchParams.get("ticket");
      const device = ticket && (await this.ctx.storage.get(`ticket:${ticket}`));
      if (
        !device ||
        device.expires < Date.now() ||
        request.headers.get("upgrade")?.toLowerCase() !== "websocket"
      )
        return new Response(null, { status: 401 });
      await this.ctx.storage.delete(`ticket:${ticket}`);
      for (const previous of this.ctx.getWebSockets(device.id))
        previous.close(4001, "Device reconnected");
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [device.id]);
      pair[1].serializeAttachment({
        ...device,
        expires: Date.now() + 10 * 60 * 1000,
      });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/destinations") {
      const devices = this.ctx.getWebSockets().flatMap((ws) => {
        const d = ws.deserializeAttachment();
        return d.expires > Date.now()
          ? [
              {
                id: d.id,
                name: d.name,
                kind: "mac",
                online: true,
                projectIds: d.projectIds,
              },
            ]
          : [];
      });
      return json([
        { id: "cloud", name: "ShowAI Cloud", kind: "cloud", online: true },
        ...devices,
      ]);
    }
    if (url.pathname === "/invoke") {
      const input = await request.clone().json();
      const call = invocation(input);
      if (call.destination === "cloud" && call.action === "agent:authorize")
        return json(
          {
            error: {
              code: "LOCAL_CHATGPT_AUTH_REQUIRED",
              message:
                "Authorize ChatGPT on your Mac and publish it to your server, then select that server model source for Cloud execution. OpenAI requires a local callback.",
            },
          },
          409,
        );
      if (call.destination !== "cloud") {
        if (!remoteTaskActions.has(call.action))
          return json(
            { error: { message: "Configure this Mac's Agent on the Mac." } },
            403,
          );
        const socket = this.ctx
          .getWebSockets(call.destination)
          .find((ws) => ws.deserializeAttachment().expires > Date.now());
        if (!socket)
          return json(
            { error: { message: "The selected Mac is offline." } },
            409,
          );
        const device = socket.deserializeAttachment();
        if (call.projectId && !device.projectIds.includes(call.projectId))
          return json(
            { error: { message: "This project is not shared by the Mac." } },
            403,
          );
        const saved = await this.ctx.storage.get(`reply:${call.requestId}`);
        const fingerprint = await derived("request", JSON.stringify(call));
        if (saved)
          return saved.fingerprint === fingerprint
            ? json(saved.reply)
            : json({ error: { message: "Request ID was reused." } }, 409);
        if (this.pending.has(call.requestId))
          return json(
            {
              error: {
                message:
                  "Request is still being processed. Retry with the same ID.",
              },
            },
            409,
          );
        const reply = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            this.pending.delete(call.requestId);
            resolve({
              ok: false,
              error: {
                message:
                  "Mac response timed out. Check the conversation before retrying.",
              },
            });
          }, 25000);
          this.pending.set(call.requestId, {
            resolve,
            timer,
            deviceId: device.id,
            fingerprint,
          });
          socket.send(JSON.stringify({ type: "invoke", ...call }));
        });
        return json(reply);
      }
    }
    return this.cloud(request);
  }
  async cloud(request) {
    const tenant = await this.ctx.storage.get("tenant");
    if (!tenant) return new Response(null, { status: 404 });
    const key = await derived(this.env.SHOWAI_AGENT_KEY, tenant);
    const container = this.ctx.container;
    if (!container.running)
      container.start({
        enableInternet: true,
        env: {
          SHOWAI_AGENT_URL: this.env.SHOWAI_AGENT_URL,
          SHOWAI_AGENT_TENANT: tenant,
          SHOWAI_AGENT_KEY: key,
        },
      });
    // Running tasks renew activity themselves, even when the iPad disconnects.
    await container.setInactivityTimeout(15 * 60 * 1000);
    const port = container.getTcpPort(8790);
    let ready = false;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        const health = await port.fetch("http://container/health", {
          signal: AbortSignal.timeout(1000),
        });
        // Only the operator health route can reach this path. Preserve startup
        // diagnostics there; user requests receive the public readiness error.
        if (new URL(request.url).pathname === "/health") {
          if (request.headers.get("x-showai-runtime-diagnostics") === "1") {
            const process = await container.exec(
              [
                "node",
                "-e",
                `
const fs=require('node:fs'),crypto=require('node:crypto');
const source=fs.readFileSync('/app/scripts/container.mjs','utf8');
let files=0,partial=0;function walk(path){for(const entry of fs.readdirSync(path,{withFileTypes:true})){const child=path+'/'+entry.name;if(entry.isDirectory())walk(child);else{files++;if(entry.name.endsWith('.restore'))partial++;}}}walk('/state');
const directory='/state/agent-host/remote-turns',jobs=fs.existsSync(directory)?fs.readdirSync(directory).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).slice(-100).map(name=>{const job=JSON.parse(fs.readFileSync(directory+'/'+name,'utf8'));return{id:job.id,phase:job.phase,state:job.turn?.state,pageId:job.turn?.pageId,error:job.turn?.error,startedAt:job.turn?.startedAt,marker:job.turn?.prompt?.match(/SHOWAI_[A-Z]+_[a-f0-9]{12}/)?.[0]}}):[];
(async()=>{let localHealth,contentNetwork;try{localHealth=await fetch('http://127.0.0.1:8790/health',{signal:AbortSignal.timeout(2000)}).then(r=>r.json())}catch(error){localHealth={error:error.message}}const start=Date.now();try{const response=await fetch(process.env.SHOWAI_DIAGNOSTIC_INFO,{signal:AbortSignal.timeout(5000)});await response.arrayBuffer();contentNetwork={status:response.status,ms:Date.now()-start}}catch(error){contentNetwork={error:error.name,ms:Date.now()-start}}console.log(JSON.stringify({node:process.version,bundleSHA256:crypto.createHash('sha256').update(source).digest('hex'),restoreProgressFeature:source.includes('onRestoreProgress'),files,partial,jobs,localHealth,contentNetwork}));})();
`,
              ],
              {
                signal: AbortSignal.timeout(10000),
                env: {
                  SHOWAI_DIAGNOSTIC_INFO:
                    this.env.SHOWAI_AGENT_SYNC_SERVICE_URL + "/api/info",
                },
              },
            );
            const output = await process.output();
            return json({
              exitCode: output.exitCode,
              stdout: new TextDecoder().decode(output.stdout),
              stderr: new TextDecoder().decode(output.stderr),
            });
          }
          if (
            request.headers.get("x-showai-recover-startup") === "1" &&
            !health.ok
          ) {
            const status = await health.json();
            if (
              status.runtime === "failed" ||
              (status.runtime === "starting" &&
                status.stage === "restore" &&
                !status.restore)
            ) {
              // No task can be admitted before readiness. Only reconstructed
              // cache files are discarded; the encrypted committed head remains.
              await container.destroy();
              return json(
                {
                  service: "showai-agent-container",
                  runtime: "restarting",
                  previous: status,
                },
                202,
              );
            }
            return json(status, 503);
          }
          return health;
        }
        if (health.ok) {
          await health.body?.cancel();
          ready = true;
          break;
        }
        const status = await health.json();
        if (status.runtime === "failed") {
          const response = json(
            {
              error: {
                code: "AGENT_UNAVAILABLE",
                message: "Cloud Agent could not start. Please retry later.",
              },
            },
            503,
          );
          response.headers.set("retry-after", "60");
          return response;
        }
      } catch {
        /* Container is still booting. */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!ready) {
      const response = json(
        {
          error: {
            code: "AGENT_STARTING",
            message: "Cloud Agent is starting. Retry shortly.",
          },
        },
        503,
      );
      response.headers.set("retry-after", "5");
      return response;
    }
    const headers = new Headers(request.headers);
    headers.set("x-showai-internal", key);
    const target = new URL(request.url);
    target.protocol = "http:";
    return port.fetch(
      new Request(target, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
      }),
    );
  }
  async webSocketMessage(socket, message) {
    try {
      if (typeof message !== "string" || message.length > 8 * 1024 * 1024) {
        socket.close(1009, "Message too large");
        return;
      }
      const input = JSON.parse(message),
        device = socket.deserializeAttachment();
      if (device.expires < Date.now()) {
        socket.close(4001, "Renew device authorization");
        return;
      }
      if (input.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }
      const pending = this.pending.get(input.requestId);
      if (!pending || pending.deviceId !== device.id) return;
      await this.ctx.storage.put(`reply:${input.requestId}`, {
        fingerprint: pending.fingerprint,
        reply: input.reply,
        expires: Date.now() + 86400000,
      });
      clearTimeout(pending.timer);
      this.pending.delete(input.requestId);
      pending.resolve(input.reply);
      await this.ctx.storage.setAlarm(Date.now() + 86400000);
    } catch {
      socket.close(1008, "Invalid device response");
    }
  }
  webSocketClose(socket) {
    const device = socket.deserializeAttachment();
    for (const [id, p] of this.pending)
      if (p.deviceId === device.id) {
        clearTimeout(p.timer);
        p.resolve({
          ok: false,
          error: {
            message:
              "Mac disconnected. Reconnect and inspect the conversation.",
          },
        });
        this.pending.delete(id);
      }
  }
  webSocketError(socket) {
    this.webSocketClose(socket);
  }
  async alarm() {
    for (const [key, value] of await this.ctx.storage.list())
      if (
        (key.startsWith("reply:") || key.startsWith("ticket:")) &&
        value.expires < Date.now()
      )
        await this.ctx.storage.delete(key);
  }
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (
        url.origin !== env.SHOWAI_AGENT_URL ||
        !/^[a-f0-9]{64}$/.test(env.SHOWAI_AGENT_KEY ?? "")
      )
        return new Response(null, { status: 503 });
      if (url.pathname === "/health")
        return json({
          service: "showai-agent",
          protocol: 1,
          revision: env.SHOWAI_AGENT_REVISION,
        });
      if (
        ["/_operations/health", "/_operations/relay-ticket"].includes(
          url.pathname,
        )
      ) {
        if (
          request.headers.get("authorization") !==
          `Bearer ${env.SHOWAI_AGENT_KEY}`
        )
          return new Response(null, { status: 404 });
        const requestedTenant = url.pathname.endsWith("/health")
          ? request.headers.get("x-showai-tenant")
          : null;
        if (requestedTenant && !/^[a-f0-9]{64}$/.test(requestedTenant))
          return json(
            {
              error: {
                code: "INVALID_TENANT",
                message: "Invalid diagnostic tenant.",
              },
            },
            400,
          );
        const tenant =
          requestedTenant ??
          (await derived(env.SHOWAI_AGENT_KEY, "deployment-health"));
        const relay = url.pathname.endsWith("relay-ticket");
        const target = new URL(relay ? "/devices/ticket" : "/health", url);
        return env.AGENTS.get(env.AGENTS.idFromName(tenant)).fetch(
          new Request(target, {
            method: relay ? "POST" : "GET",
            headers: {
              "x-showai-tenant": tenant,
              "content-type": "application/json",
              ...(request.headers.get("x-showai-runtime-diagnostics") === "1"
                ? { "x-showai-runtime-diagnostics": "1" }
                : {}),
              ...(request.headers.get("x-showai-recover-startup") === "1"
                ? { "x-showai-recover-startup": "1" }
                : {}),
            },
            ...(relay
              ? {
                  body: JSON.stringify({
                    deviceId: crypto.randomUUID(),
                    name: "Deployment verification",
                    projectIds: [],
                  }),
                }
              : {}),
          }),
        );
      }
      const activity = url.pathname.match(/^\/activity\/([a-f0-9]{64})$/);
      if (activity) {
        if (
          request.headers.get("authorization") !==
          `Bearer ${await derived(env.SHOWAI_AGENT_KEY, activity[1])}`
        )
          return new Response(null, { status: 404 });
        return env.AGENTS.get(env.AGENTS.idFromName(activity[1])).fetch(
          request,
        );
      }
      const stored = url.pathname.match(
        /^\/__state\/([a-f0-9]{64})\/(head|[a-f0-9]{64})$/,
      );
      if (stored) return state(request, env, stored[1], stored[2]);
      const route = url.pathname.match(
        /^\/(?:devices\/connect|oauth)\/([a-f0-9]{64})(?:\/auth\/callback)?$/,
      );
      if (route) {
        if (url.pathname.startsWith("/oauth/")) {
          const headers = new Headers(request.headers);
          headers.set("x-showai-tenant", route[1]);
          return env.AGENTS.get(env.AGENTS.idFromName(route[1])).fetch(
            new Request(request, { headers }),
          );
        }
        return env.AGENTS.get(env.AGENTS.idFromName(route[1])).fetch(request);
      }
      if (
        request.method !== "POST" ||
        !["/invoke", "/destinations", "/devices/ticket"].includes(url.pathname)
      )
        return new Response(null, { status: 404 });
      const body = await request.text();
      if (body.length > 1024 * 1024) return new Response(null, { status: 413 });
      const input = JSON.parse(body),
        { tenant, actor } = await identity(input, env);
      if (url.pathname === "/invoke") invocation(input);
      const headers = new Headers({
        "content-type": "application/json",
        "x-showai-tenant": tenant,
        "x-showai-actor": JSON.stringify(actor),
      });
      return env.AGENTS.get(env.AGENTS.idFromName(tenant)).fetch(
        new Request(request.url, { method: "POST", headers, body }),
      );
    } catch (error) {
      const response = json(
        { ok: false, error: { code: error.code, message: error.message } },
        error.status ?? 400,
      );
      if (error.retryAfter)
        response.headers.set("retry-after", error.retryAfter);
      return response;
    }
  },
};

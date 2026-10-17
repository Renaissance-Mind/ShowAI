import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { CloudState } from "../agent/cloud-state";
import { RemoteAgentEngine } from "./remote-engine";
import { SdkInstaller } from "./installer";
import { checkCloudBrowser } from "../agent/cloud-browser-check";
import { withLibraryLock } from "../core/library-lock";
import { execute } from "./process";
import { ignoreRemoteAgentState } from "./remote-state";
import { remoteReadActions, type RemoteActor } from "./remote-protocol";

const directory = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = process.env.SHOWAI_AGENT_RUNTIME ?? "/runtime";
if (process.argv.includes("--install-runtime")) {
  const installer = new SdkInstaller(runtimeRoot, {
    cacheRoot: process.env.SHOWAI_AGENT_DOWNLOAD_CACHE,
    version: process.env.SHOWAI_AGENT_SDK_VERSION,
  });
  installer.start();
  await installer.wait();
} else {
  const origin = process.env.SHOWAI_AGENT_URL!,
    tenant = process.env.SHOWAI_AGENT_TENANT!,
    key = process.env.SHOWAI_AGENT_KEY!;
  if (!origin || !/^[a-f0-9]{64}$/.test(tenant) || !/^[a-f0-9]{64}$/.test(key))
    throw new Error("Cloud Agent identity is not configured.");
  let stage = "restore";
  let startupError: string | undefined;
  let restoreProgress = { completed: 0, total: 0 };
  let health: Record<string, unknown> | undefined;
  let invoke:
    | ((request: IncomingMessage, response: ServerResponse) => Promise<void>)
    | undefined;
  const server = createServer((request, response) => {
    const run = async () => {
      if (request.url === "/health" || !invoke) {
        response.writeHead(health ? 200 : 503, {
          "content-type": "application/json",
          "cache-control": "no-store",
          ...(!health ? { "retry-after": startupError ? "60" : "5" } : {}),
        });
        response.end(
          JSON.stringify(
            request.url === "/health"
              ? (health ?? {
                  service: "showai-agent-container",
                  taskAdmission: "checkpointed-before-start",
                  runtime: startupError ? "failed" : "starting",
                  stage,
                  ...(stage === "restore" ? { restore: restoreProgress } : {}),
                  error: startupError,
                })
              : {
                  error: {
                    code: startupError ? "AGENT_UNAVAILABLE" : "AGENT_STARTING",
                    message: startupError
                      ? "Cloud Agent could not start. Please retry later."
                      : "Cloud Agent is starting. Retry shortly.",
                  },
                },
          ),
        );
        return;
      }
      await invoke(request, response);
    };
    void run().catch((error) => {
      if (!response.headersSent)
        response.writeHead(error.status ?? 400, {
          "content-type": "application/json",
          ...(error.details?.retryAfter
            ? { "retry-after": String(error.details.retryAfter) }
            : {}),
        });
      response.end(
        JSON.stringify({
          ok: false,
          error: { code: error.code, message: error.message },
        }),
      );
    });
  });
  server.listen(8790, "0.0.0.0");
  const boot = async () => {
    const stateRequest = async (
      name: string,
      bytes?: Uint8Array,
    ): Promise<{ status: number; body: Uint8Array }> => {
      for (let attempt = 0; ; attempt++) {
        try {
          const response = await fetch(`${origin}/__state/${tenant}/${name}`, {
            method: bytes ? "PUT" : "GET",
            headers: { authorization: `Bearer ${key}` },
            ...(bytes ? { body: Buffer.from(bytes) } : {}),
            signal: AbortSignal.timeout(60000),
            redirect: "error",
          });
          if ([502, 503, 504].includes(response.status) && attempt < 2) {
            await response.body?.cancel();
          } else
            return {
              status: response.status,
              body: new Uint8Array(await response.arrayBuffer()),
            };
        } catch (error) {
          if (
            attempt >= 2 ||
            (!(error instanceof TypeError) &&
              !["TimeoutError", "AbortError"].includes((error as Error).name))
          )
            throw error;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1)),
        );
      }
    };
    const state = new CloudState(
      "/state",
      {
        async get(name) {
          const response = await stateRequest(name);
          if (response.status === 404) return null;
          if (response.status < 200 || response.status >= 300)
            throw new Error(`State read failed (${response.status}).`);
          return response.body;
        },
        async put(name, bytes) {
          const response = await stateRequest(name, bytes);
          if (response.status < 200 || response.status >= 300)
            throw new Error(`State checkpoint failed (${response.status}).`);
        },
      },
      key,
      {
        snapshotSqlite: true,
        ignore: ignoreRemoteAgentState,
        onRestoreProgress: (completed, total) => {
          restoreProgress = { completed, total };
        },
      },
    );
    await state.restore();
    stage = "browser";
    const browserRendering = await checkCloudBrowser();
    let checkpointTail: Promise<unknown> = Promise.resolve();
    const checkpoint = () => {
      const next = checkpointTail.then(() =>
        state.save((read) => withLibraryLock("/state/library", read)),
      );
      checkpointTail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    };
    const engine = new RemoteAgentEngine({
      root: "/state/agent-host",
      library: "/state/library",
      runtimeRoot,
      afterAuthorization: checkpoint,
      deferTaskStart: true,
      cli: () => ({
        command: process.execPath,
        args: [join(directory, "cli.mjs")],
        env: { SHOWAI_HOME: "/state/library" },
      }),
      pluginRoot: () => join(directory, "../assets/agent-plugin"),
      oauthRedirectUrl: `${origin}/oauth/${tenant}/auth/callback`,
    });
    stage = "runtime";
    const runtimePaths = await engine.host.installer.paths();
    await engine.host.prepareRuntime();
    stage = "sandbox";
    const sandboxResult = await execute(
      runtimePaths.binary,
      ["sandbox", "-c", 'sandbox_mode="workspace-write"', "--", "/bin/true"],
      { cwd: "/tmp", timeout: 10000 },
    );
    const sandbox = {
      passed: sandboxResult.code === 0,
      detail:
        sandboxResult.code === 0
          ? undefined
          : sandboxResult.stderr.replaceAll(key, "[redacted]").slice(0, 1000),
    };
    if (!sandbox.passed)
      throw new Error(`Agent sandbox verification failed: ${sandbox.detail}`);
    const authorized = (value: string) =>
      value.length === key.length &&
      timingSafeEqual(Buffer.from(value), Buffer.from(key));
    invoke = async (request, response) => {
      if (!authorized(String(request.headers["x-showai-internal"] ?? ""))) {
        response.writeHead(401);
        response.end();
        return;
      }
      if (request.url?.startsWith(`/oauth/${tenant}/auth/callback`)) {
        engine.host.chatgpt.handleCallback(request, response);
        return;
      }
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 1024 * 1024)
          throw new Error("Agent request is too large.");
      }
      const actor = JSON.parse(
        String(request.headers["x-showai-actor"] ?? "null"),
      ) as RemoteActor;
      if (!actor) throw new Error("Account context is required.");
      const call = JSON.parse(body),
        value = await engine.invoke(call, actor);
      const admittedId =
        call.action === "agent:send"
          ? (value as { turns: { id: string }[] }).turns.at(-1)?.id
          : undefined;
      try {
        if (!remoteReadActions.has(call.action)) await checkpoint();
      } catch (error) {
        if (admittedId)
          await engine.turns.failAdmission(
            admittedId,
            "Task admission could not be checkpointed. Review the conversation before retrying.",
          );
        throw error;
      }
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ ok: true, data: value }));
      if (admittedId) engine.turns.startAdmitted(admittedId);
    };
    // Persist running turns and keep the Container active independently of iPad polling.
    const timer = setInterval(() => {
      void (async () => {
        await checkpoint();
        if (
          engine.turns.running ||
          engine.host.conversations.running().length
        ) {
          const response = await fetch(`${origin}/activity/${tenant}`, {
            method: "POST",
            headers: { authorization: `Bearer ${key}` },
            redirect: "error",
          });
          if (!response.ok)
            throw new Error("Container activity renewal failed.");
        }
      })().catch((error) => console.error("Agent checkpoint:", error.message));
    }, 10000);
    health = {
      service: "showai-agent-container",
      taskAdmission: "checkpointed-before-start",
      runtime: (await engine.host.installer.status()).state,
      browserRendering,
      sandbox,
    };
    stage = "ready";
    process.once("SIGTERM", () => {
      clearInterval(timer);
      engine.host.close();
      server.close(() => {
        void checkpoint().then(
          () => process.exit(0),
          () => process.exit(1),
        );
      });
    });
  };
  await boot().catch((error) => {
    startupError = String(error.stack ?? error.message ?? error)
      .replaceAll(key, "[redacted]")
      .slice(0, 4000);
    console.error(`Agent startup failed at ${stage}:`, startupError);
  });
}

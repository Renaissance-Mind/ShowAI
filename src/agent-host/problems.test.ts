import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { createServer } from "node:http";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startModelGateway } from "./gateway";
import { execute, RpcProcess } from "./process";
import {
  AgentFailure,
  PROBLEM_DETAIL_LIMIT,
  classifyFailure,
  gatewayProblem,
} from "./problems";
import { installFailure } from "./installer";
import { errorResult } from "../agent/service";

let directory: string;
const cleanup: (() => void)[] = [];
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "showai-agent-problems-"));
});
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** A real executable that writes stderr and exits with the given code. */
async function failingAgent(stderr: string, code: number) {
  const path = join(directory, `agent-${code}-${Date.now()}.sh`);
  await writeFile(path, `#!/bin/sh\nprintf '%s' "$1" >&2\nexit ${code}\n`);
  await chmod(path, 0o755);
  return (args: string[] = [stderr]) => execute(path, args, { timeout: 10000 });
}

async function provider(status: number, body: unknown) {
  const server = createServer((_request, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => {
    server.closeAllConnections();
    server.close();
  });
  const port = (server.address() as { port: number }).port;
  const gateway = await startModelGateway(
    {
      id: "source",
      name: "Local test",
      provider: "custom",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "model",
      protocol: "responses",
      credential: "api-key",
    },
    async () => "sk-test-credential-0000",
  );
  cleanup.push(gateway.close);
  await fetch(gateway.url + "/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${gateway.secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ input: [], model: "model" }),
  }).then((response) => response.body?.cancel());
  return gateway.failure();
}

test("provider statuses map to problem codes without credentials in details", async () => {
  const unauthorized = await provider(401, {
    error: { message: "Incorrect API key provided: sk-test-credential-0000" },
  });
  expect(unauthorized?.status).toBe(401);
  const invalid = gatewayProblem(unauthorized!, { name: "Local test" });
  expect(invalid.problem.code).toBe("invalid_credentials");
  expect(invalid.problem.status).toBe(401);
  expect(invalid.problem.detail).not.toContain("sk-test-credential-0000");

  const limited = await provider(429, {
    error: { code: "insufficient_quota", message: "You exceeded your quota" },
  });
  expect(gatewayProblem(limited!).problem.code).toBe("rate_limited");

  const missing = await provider(404, {
    error: { code: "model_not_found", message: "The model does not exist" },
  });
  expect(gatewayProblem(missing!).problem.code).toBe("model_not_found");

  const server = await provider(503, { error: { message: "overloaded" } });
  expect(gatewayProblem(server!).problem).toMatchObject({
    code: "provider_error",
    status: 503,
  });
});

test("an unreachable provider is a network problem", async () => {
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const port = (closed.address() as { port: number }).port;
  await new Promise<void>((resolve) => closed.close(() => resolve()));
  const gateway = await startModelGateway(
    {
      id: "source",
      name: "Closed",
      provider: "custom",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "model",
      protocol: "responses",
      credential: "api-key",
    },
    async () => "local",
  );
  cleanup.push(gateway.close);
  const response = await fetch(gateway.url + "/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${gateway.secret}` },
    body: JSON.stringify({ input: [], model: "model" }),
  });
  await response.body?.cancel();
  expect(response.status).toBe(502);
  expect(gatewayProblem(gateway.failure()!).problem.code).toBe("network");
});

test("a local Agent that exits non-zero keeps its exit code and a bounded stderr", async () => {
  const run = await failingAgent("x".repeat(70000), 1);
  const result = await run();
  expect(result.code).toBe(1);
  const problem = classifyFailure(
    new AgentFailure({
      code: "process_exited",
      exitCode: result.code,
      name: "Codex",
      detail: result.stderr,
    }),
  );
  expect(problem.code).toBe("process_exited");
  expect(problem.exitCode).toBe(1);
  expect(problem.summary).toContain("1");
  expect(problem.detail!.length).toBeLessThan(PROBLEM_DETAIL_LIMIT + 200);
});

test("stderr naming a known reason refines a process exit", async () => {
  const run = await failingAgent("Error: 429 Too Many Requests", 2);
  const result = await run();
  const problem = classifyFailure(
    new AgentFailure({
      code: "process_exited",
      exitCode: result.code,
      detail: result.stderr,
    }),
  );
  expect(problem.code).toBe("rate_limited");
  const signIn = classifyFailure(new Error("x"), {
    output: "Not logged in · Please run /login",
  });
  expect(signIn.code).toBe("sign_in_required");
  expect(
    classifyFailure(new Error("Codex Exec exited with code 3: oops")),
  ).toMatchObject({
    code: "process_exited",
    exitCode: 3,
  });
  expect(classifyFailure(new Error("something new")).code).toBe("unknown");
});

test("an ACP agent that closes its connection reports a process exit", async () => {
  const path = join(directory, "acp.sh");
  await writeFile(path, "#!/bin/sh\necho 'cannot start' >&2\nexit 7\n");
  await chmod(path, 0o755);
  const rpc = new RpcProcess(
    path,
    [],
    directory,
    () => {},
    new AbortController().signal,
  );
  const failure = await rpc.request("initialize", {}).catch((error) => error);
  expect(failure).toBeInstanceOf(AgentFailure);
  expect(failure.problem).toMatchObject({
    code: "process_exited",
    exitCode: 7,
  });
  expect(failure.problem.detail).toContain("cannot start");
});

test("the classification survives the IPC error result", () => {
  const result = errorResult(new AgentFailure({ code: "no_model_source" }));
  expect(result.problem).toMatchObject({ code: "no_model_source" });
  expect(result.message).toBe((result.problem as { summary: string }).summary);
});

test("SDK install failures are classified for a localized reason", () => {
  expect(
    installFailure(
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ENOTFOUND" },
      }),
    ),
  ).toBe("network");
  expect(
    installFailure(Object.assign(new Error("HTTP 503"), { status: 503 })),
  ).toBe("registry");
  expect(
    installFailure(Object.assign(new Error("full"), { code: "ENOSPC" })),
  ).toBe("disk");
  expect(
    installFailure(
      new Error("Downloaded package integrity does not match the registry."),
    ),
  ).toBe("integrity");
});

import { afterAll, beforeAll, expect, test } from "vitest";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";
import { createHash, generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { AgentHost, isolatedEnvironment, copyEmbeddedPlugin } from "./host";
import { verifyArchive } from "./installer";
import { verifyIdToken } from "./chatgpt";
import { chatRequest, chatResponse } from "./gateway";
import { FileStore } from "../core/store";
import { openLibrary } from "../core/open-library";
import { execute } from "./process";
import { writeProtected } from "./storage";
import { ChatGptConnection } from "./chatgpt";

let directory: string, host: AgentHost;
const repository = resolve(import.meta.dirname, "../..");
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "showai-agent-host-test-"));
  const library = new FileStore(join(directory, "library"));
  await openLibrary(library.root);
  host = new AgentHost({
    root: join(directory, "agent"),
    workspaceRoot: join(directory, "workspaces"),
    library: () => library,
    cli: () => ({
      command: process.execPath,
      args: [
        join(repository, ".showai-dev/desktop-5173/runtime/scripts/cli.mjs"),
      ],
      env: { SHOWAI_HOME: library.root },
    }),
    pluginRoot: () => join(repository, "plugins/showai"),
  });
});
afterAll(async () => {
  host.close();
  await rm(directory, { recursive: true, force: true });
});

test("provider secrets stay outside settings responses and use protected files", async () => {
  const source = {
    id: randomUUID(),
    name: "Local service",
    provider: "custom",
    baseUrl: "http://127.0.0.1:4000/v1",
    model: "test",
    protocol: "responses",
    credential: "api-key",
  };
  const result = await host.saveSource(
    source,
    "test-credential-not-a-real-key",
  );
  expect(JSON.stringify(result)).not.toContain("test-credential");
  expect(result.settings.sources[0].apiKeyPresent).toBe(true);
  if (process.platform !== "win32")
    expect(
      (await stat(join(directory, "agent/credentials", source.id + ".json")))
        .mode & 0o777,
    ).toBe(0o600);
  await expect(
    host.saveSource({ ...source, baseUrl: "https://user:secret@example.com" }),
  ).rejects.toThrow("凭据");
  await expect(
    host.saveSource({ ...source, id: randomUUID(), credential: "chatgpt" }),
  ).rejects.toThrow("官方");
});
test("isolated child environment excludes existing credentials and host thread", () => {
  const env = isolatedEnvironment(
    join(directory, "embedded"),
    join(directory, "workspaces"),
  );
  expect(env.CODEX_HOME).toBe(join(directory, "embedded/codex"));
  expect(env.HOME).not.toBe(homedir());
  for (const variable of [
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "CODEX_ACCESS_TOKEN",
    "CODEX_THREAD_ID",
    "CODEX_REMOTE_TOKEN",
  ])
    expect(env[variable]).toBeUndefined();
});
test("npm archive integrity failures are exposed", () => {
  const bytes = Buffer.from("package bytes");
  const integrity =
    "sha512-" + createHash("sha512").update(bytes).digest("base64");
  expect(() => verifyArchive(bytes, integrity)).not.toThrow();
  expect(() => verifyArchive(Buffer.from("changed"), integrity)).toThrow(
    "integrity",
  );
});
test("identity validation rejects wrong audience, nonce and signature", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const key = { ...publicKey.export({ format: "jwk" }), kid: "test-key" };
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: key.kid }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      iss: "https://auth.openai.com",
      aud: "oaiapp_test",
      nonce: "nonce",
      sub: "subject",
      email: "test@example.com",
      exp: Date.now() / 1000 + 300,
    }),
  ).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(header + "." + body),
    privateKey,
  ).toString("base64url");
  const token = header + "." + body + "." + signature;
  expect(verifyIdToken(token, { keys: [key] }, "oaiapp_test", "nonce")).toEqual(
    { subject: "subject", email: "test@example.com" },
  );
  expect(() => verifyIdToken(token, { keys: [key] }, "other", "nonce")).toThrow(
    "claims",
  );
  expect(() =>
    verifyIdToken(token, { keys: [key] }, "oaiapp_test", "wrong"),
  ).toThrow("claims");
  expect(() =>
    verifyIdToken(
      token.slice(0, -20) + "a".repeat(20),
      { keys: [key] },
      "oaiapp_test",
      "nonce",
    ),
  ).toThrow("signature");
});
test("chat adapter preserves namespaces and tool-result pairing", async () => {
  const request = chatRequest({
    model: "model",
    tools: [
      {
        type: "namespace",
        name: "showai",
        tools: [
          {
            type: "function",
            name: "page_read",
            parameters: { type: "object" },
          },
        ],
      },
    ],
    input: [
      { role: "user", content: [{ type: "input_text", text: "read" }] },
      {
        type: "function_call",
        name: "page_read",
        namespace: "showai",
        call_id: "call-1",
        arguments: "{}",
      },
      { type: "function_call_output", call_id: "call-1", output: "page data" },
    ],
  });
  expect(request.body.messages[1].tool_calls[0].id).toBe("call-1");
  expect(request.body.messages[2].tool_call_id).toBe("call-1");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const item of [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-2",
                    function: { name: "t0_page_read", arguments: "{}" },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ])
        controller.enqueue(
          encoder.encode("data: " + JSON.stringify(item) + "\n\n"),
        );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const events = [];
  for await (const event of chatResponse(stream, request.tools, "model"))
    events.push(event);
  expect(events.at(-1)?.response.output[0]).toMatchObject({
    type: "function_call",
    name: "page_read",
    namespace: "showai",
    call_id: "call-2",
  });
  expect(events.at(-1)?.type).toBe("response.completed");
});
const live = process.env.SHOWAI_AGENT_LIVE === "1";
test("task downloads cannot expose credentials outside the task workspace", async () => {
  const id = randomUUID(),
    workspace = join(directory, "downloads", id);
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "result.md"), "Generated task file");
  const root = join(directory, "download-host");
  await writeProtected(join(root, "tasks", id + ".json"), {
    id,
    projectId: "",
    label: "File fixture",
    mode: "local",
    state: "completed",
    workspace,
    startedAt: new Date().toISOString(),
    events: [],
  });
  await writeProtected(join(root, "credentials", "private.json"), {
    confidential: "private fixture",
  });
  const reader = new AgentHost({ ...host.options, root });
  expect(
    Buffer.from(
      (await reader.readTaskFile(id, "./result.md")).base64,
      "base64",
    ).toString(),
  ).toBe("Generated task file");
  await expect(
    reader.readTaskFile(id, join(root, "credentials/private.json")),
  ).rejects.toThrow("任务工作区");
  reader.close();
});
test("server-owned credentials never fall back to local OAuth refresh", async () => {
  const id = randomUUID(),
    root = join(directory, "hosted-reference");
  await writeProtected(join(root, "credentials", id + ".json"), {
    refreshOwner: "server",
    connectionId: "server-connection",
    email: "account@example.com",
  });
  const connection = new ChatGptConnection(root);
  await expect(connection.accessToken(id, true)).rejects.toThrow(
    "服务器凭据管理尚未连接",
  );
  expect(await connection.credentials(id)).toMatchObject({
    refreshOwner: "server",
    connectionId: "server-connection",
  });
});
test.skipIf(!process.env.SHOWAI_SDK_RECEIPT)(
  "installed SDK executes in isolation and reports an actual unavailable endpoint",
  async () => {
    const receipt = JSON.parse(
      await readFile(process.env.SHOWAI_SDK_RECEIPT!, "utf8"),
    );
    await writeProtected(
      join(host.options.root, "runtime/installed.json"),
      receipt,
    );
    const source = {
      id: randomUUID(),
      name: "Unavailable loopback endpoint",
      provider: "custom",
      baseUrl: "http://127.0.0.1:9/v1",
      model: "gpt-6.1-sol",
      protocol: "responses",
      credential: "api-key",
    };
    await host.saveSource(source);
    await host.save({ ...(await host.settings()), mode: "api" });
    const task = await host.start({ test: true });
    const deadline = Date.now() + 120000;
    let result = (await host.status()).tasks.find(
      (item) => item.id === task.id,
    )!;
    while (result.state === "running" && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 500));
      result = (await host.status()).tasks.find((item) => item.id === task.id)!;
    }
    expect(result.state).toBe("failed");
    if (!result.threadId) console.info("SDK startup error:", result.error);
    expect(result.threadId).toBeTruthy();
    expect(result.error).toMatch(
      /502|bad port|模型服务|stream|request|response/i,
    );
  },
  150000,
);
async function finish(id: string) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const task = (await host.status()).tasks.find((task) => task.id === id)!;
    if (task.state !== "running") {
      expect(task.error ?? "").toBe("");
      expect(task.state).toBe("completed");
      return task;
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  host.cancel(id);
  throw new Error("Live Agent test timed out.");
}
test.skipIf(!live)(
  "existing agents return real results or expose expired authentication",
  async () => {
    const status = await host.scan();
    for (const id of ["codex", "kimi"] as const) {
      expect(status.agents.find((agent) => agent.id === id)?.path).toBeTruthy();
      const task = await host.start({ test: true, localAgent: id });
      if (id === "kimi") {
        const deadline = Date.now() + 150000;
        let result = (await host.status()).tasks.find(
          (item) => item.id === task.id,
        )!;
        while (result.state === "running" && Date.now() < deadline) {
          await new Promise((done) => setTimeout(done, 1000));
          result = (await host.status()).tasks.find(
            (item) => item.id === task.id,
          )!;
        }
        if (
          result.state === "failed" &&
          /Authentication required|login_required|需要登录/.test(
            result.error ?? "",
          )
        ) {
          expect(result.error).toMatch(
            /Authentication required|login_required|需要登录/,
          );
          return;
        }
      }
      const completed = await finish(task.id);
      expect(
        completed.events
          .filter((event) => event.type === "message")
          .map((event) => event.text)
          .join(""),
      ).toContain("SHOWAI_AGENT_READY");
    }
  },
  360000,
);
test.skipIf(!live)(
  "local Codex edits a real isolated ShowAI page through MCP",
  async () => {
    const project = await host.options
      .library()
      .createProject({ name: "Agent acceptance" });
    const page = await host.options
      .library()
      .createPage(project.id, { title: "Before agent edit" });
    const task = await host.start({
      projectId: project.id,
      pageId: page.document.id,
      prompt:
        "Read the focused page with ShowAI MCP. Change only its title to Agent acceptance passed and save with the current hash and revision. Leave all other page content intact. Do not create another page, export or use browser tools.",
    });
    const completed = await finish(task.id);
    expect(
      completed.events.some(
        (event) => event.type === "tool" && event.text.includes("page_save"),
      ),
    ).toBe(true);
    const saved = await host.options
      .library()
      .readPage(project.id, page.document.id);
    if (saved.document.title !== "Agent acceptance passed")
      console.info(
        completed.events.filter(
          (event) => event.type === "message" || event.type === "tool",
        ),
      );
    expect(saved.document.title).toBe("Agent acceptance passed");
    expect(saved.hash).not.toBe(page.hash);
  },
  240000,
);
test.skipIf(!live)(
  "official SDK installs independently with only the ShowAI plugin",
  async () => {
    const externalAuth = join(homedir(), ".codex/auth.json"),
      externalConfig = join(homedir(), ".codex/config.toml");
    const digest = async (path: string) =>
      readFile(path).then(
        (bytes) => createHash("sha256").update(bytes).digest("hex"),
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        },
      );
    const before = await Promise.all([
      digest(externalAuth),
      digest(externalConfig),
    ]);
    host.installer.start();
    await host.installer.wait();
    const paths = await host.installer.paths();
    expect((await execute(paths.binary, ["--version"])).stdout).toContain(
      paths.version,
    );
    await (host as any).prepareIsolation();
    const env = isolatedEnvironment(
      join(directory, "agent/embedded"),
      join(directory, "workspaces"),
    );
    const listing = JSON.parse(
      (
        await execute(paths.binary, ["plugin", "list", "--json"], {
          env,
          cwd: join(directory, "workspaces"),
        })
      ).stdout,
    );
    expect(listing.installed.map((plugin: any) => plugin.pluginId)).toEqual([
      "showai@showai-embedded",
    ]);
    expect(
      await Promise.all([digest(externalAuth), digest(externalConfig)]),
    ).toEqual(before);
  },
  240000,
);

test("embedded plugin keeps workflows without adding a library-wide MCP connection", async () => {
  const source = join(repository, "plugins/showai");
  const destination = join(directory, "embedded-plugin");
  const original = await readFile(join(source, "mcp.json"), "utf8");
  await copyEmbeddedPlugin(source, destination);
  await expect(stat(join(destination, "mcp.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(join(source, "mcp.json"), "utf8")).toBe(original);
  for (const name of [
    "use-showai",
    "show-document",
    "create-component",
    "create-template",
  ])
    expect(
      (await stat(join(destination, "skills", name, "SKILL.md"))).isFile(),
    ).toBe(true);
});

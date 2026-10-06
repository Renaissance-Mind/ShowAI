import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "vitest";
import { build } from "esbuild";
import { rawSourcePlugin } from "../../scripts/raw-source-plugin.mjs";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { request as httpRequest } from "node:http";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startBrowserServer } from "./server";
import { AgentService } from "../agent/service";
import { GitLibrary } from "../core/git-library";
import type { DesktopInfo, DesktopResponse } from "../desktop/bridge";
import type { LoadedPage } from "../studio/usePage";

const execute = promisify(execFile);
const repository = resolve(import.meta.dirname, "../..");
let bundle: string,
  cli: string,
  home: string,
  settingsPath: string,
  token: string;
let server: Awaited<ReturnType<typeof startBrowserServer>>;

beforeAll(async () => {
  await mkdir(join(repository, "node_modules/.cache"), { recursive: true });
  bundle = await mkdtemp(
    join(repository, "node_modules/.cache/showai-browser-test-"),
  );
  cli = join(bundle, "scripts/cli.mjs");
  await build({
    entryPoints: [join(repository, "src/agent/cli.ts")],
    outfile: cli,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["esbuild"],
    plugins: [rawSourcePlugin],
    banner: {
      js: 'import { createRequire as __showaiCreateRequire } from "node:module"; const require = __showaiCreateRequire(import.meta.url);',
    },
  });
  await execute(
    process.execPath,
    [
      join(repository, "node_modules/vite/bin/vite.js"),
      "build",
      "--outDir",
      join(bundle, "web"),
    ],
    { cwd: repository },
  );
  await mkdir(join(bundle, "assets"));
  await cp(
    join(repository, "dist-portable/portable.html"),
    join(bundle, "assets/viewer.html"),
  );
}, 30000);
afterAll(async () => {
  await rm(bundle, { recursive: true, force: true });
});
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-browser-library-"));
  settingsPath = join(home, "browser-settings.json");
  server = await startBrowserServer({
    home,
    webRoot: join(bundle, "web"),
    cliEntry: cli,
    settingsPath,
  });
  const html = await (await fetch(server.url)).text();
  token = JSON.parse(
    html.match(/window\.__SHOWAI_LOCAL__=(\{[^<]+\})<\/script>/)![1],
  ).token;
});
afterEach(async () => {
  await server.close();
  await rm(home, { recursive: true, force: true });
});
async function request<T>(
  route: string,
  args: Record<string, unknown>,
): Promise<DesktopResponse<T>> {
  const response = await fetch(server.url + "api/" + route, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  return response.json();
}
async function invoke<T>(
  action: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await request<T>("invoke", { action, args });
  if (!result.ok) throw result.error;
  return result.data;
}
async function runCli(args: string[]) {
  const output = await execute(process.execPath, [
    cli,
    ...args,
    "--home",
    home,
    "--json",
  ]);
  const result = JSON.parse(output.stdout);
  if (!result.ok) throw result.error;
  return result.data;
}

test("browser workbench, standalone CLI and a second client share real files and preserve conflicts", async () => {
  const info = await invoke<DesktopInfo>("app:info");
  expect(info.mode).toBe("browser");
  expect(info.cli.args).toEqual([cli]);
  const registration = JSON.parse(
    await readFile(join(home, "agent-runtime.json"), "utf8"),
  );
  expect(registration.launch).toEqual(info.cli);
  const project = await invoke<{ id: string }>("projects:create", {
    name: "Browser project",
  });
  const folder = await invoke<{ id: string }>("folders:create", {
    projectId: project.id,
    name: "Research",
  });
  const original = await invoke<LoadedPage>("pages:create", {
    projectId: project.id,
    title: "Before",
    parentId: folder.id,
  });
  const saved = await invoke<LoadedPage>("pages:save", {
    projectId: project.id,
    pageId: original.document.id,
    baseHash: original.hash,
    document: { ...original.document, title: "Browser saved" },
  });
  const agent = await runCli([
    "pages",
    "read",
    original.document.id,
    "--project",
    project.id,
  ]);
  expect(agent.hash).toBe(saved.hash);
  const operations = join(home, "agent-operations.json");
  await writeFile(
    operations,
    JSON.stringify([{ type: "page.set", fields: { title: "Agent saved" } }]),
  );
  await runCli([
    "pages",
    "apply",
    original.document.id,
    "--project",
    project.id,
    "--input",
    operations,
    "--base-hash",
    saved.hash,
  ]);
  const latest = await invoke<LoadedPage>("pages:get", {
    projectId: project.id,
    pageId: original.document.id,
  });
  expect(latest.document.title).toBe("Agent saved");
  const stale = await request("invoke", {
    action: "pages:save",
    args: {
      projectId: project.id,
      pageId: original.document.id,
      baseHash: saved.hash,
      document: saved.document,
    },
  });
  expect(stale).toMatchObject({
    ok: false,
    error: { code: "CONFLICT", currentHash: latest.hash },
  });
  expect(
    (
      await new AgentService({ root: home }).readPage(
        project.id,
        original.document.id,
      )
    ).document.title,
  ).toBe("Agent saved");
});

test("filesystem notifications include writes from an independent CLI process", async () => {
  const response = await fetch(server.url + "api/events?token=" + token);
  const reader = response.body!.getReader();
  await reader.read(); // initial library refresh
  await runCli(["projects", "create", "--name", "From Agent"]);
  const update = await reader.read();
  expect(new TextDecoder().decode(update.value)).toContain('"type":"files"');
  await reader.cancel();
}, 10000);

test("real component compilation, templates, source import and HTML/site export work locally", async () => {
  const project = await invoke<{ id: string }>("projects:create", {
    name: "Exports",
  });
  const component = await invoke<{
    id: string;
    version: string;
    integrity: string;
  }>("components:createExample", { projectId: project.id });
  const source = await invoke("components:source", {
    projectId: project.id,
    id: component.id,
    version: component.version,
  });
  expect(source).toHaveProperty("source");
  const page = await invoke<LoadedPage>("pages:create", {
    projectId: project.id,
    title: "Exported",
  });
  const template = await invoke<{ id: string }>("templates:save", {
    projectId: project.id,
    pageId: page.document.id,
    name: "Local template",
  });
  const fromTemplate = await invoke<LoadedPage>("pages:create", {
    projectId: project.id,
    templateId: template.id,
  });
  expect(fromTemplate.document.id).not.toBe(page.document.id);
  const imported = await invoke("components:import", {
    projectId: project.id,
    selectedPath: join(repository, "resources/catalog/value-slider"),
  });
  expect(imported).toHaveProperty("id", "value-slider");
  const htmlPath = join(home, "page.html");
  await invoke("export:page", {
    projectId: project.id,
    pageId: page.document.id,
    format: "html",
    selectedPath: htmlPath,
  });
  expect(await readFile(htmlPath, "utf8")).toContain("showai-data");
  const file = await invoke<{ name: string; content: string }>(
    "dialog:openPage",
    { selectedPath: htmlPath },
  );
  const reimported = await invoke<LoadedPage>("pages:import", {
    projectId: project.id,
    artifact: file.content,
  });
  expect(reimported.document.title).toBe("Exported");
  await mkdir(join(home, "site"));
  await invoke("export:site", {
    projectId: project.id,
    selectedPath: join(home, "site"),
  });
  expect(await readFile(join(home, "site/index.html"), "utf8")).toContain(
    "Exported",
  );
}, 30000);

test("loopback API rejects missing tokens, foreign origins, rebinding, invalid paths and static traversal", async () => {
  const input = JSON.stringify({ action: "projects:list", args: {} });
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  expect(
    (await fetch(server.url + "api/invoke", { method: "POST", body: input }))
      .status,
  ).toBe(401);
  expect(
    (
      await fetch(server.url + "api/invoke", {
        method: "POST",
        headers: { ...headers, Origin: "https://example.com" },
        body: input,
      })
    ).status,
  ).toBe(403);
  const reboundStatus = await new Promise<number | undefined>(
    (done, reject) => {
      const request = httpRequest(
        server.url,
        { headers: { Host: "attacker.example" } },
        (response) => {
          response.resume();
          done(response.statusCode);
        },
      );
      request.on("error", reject);
      request.end();
    },
  );
  expect(reboundStatus).toBe(403);
  expect(
    (
      await fetch(server.url + "api/invoke", {
        method: "POST",
        headers: { ...headers, Authorization: "Bearer " + "x".repeat(64) },
        body: input,
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await fetch(server.url + "api/invoke", {
        method: "POST",
        headers,
        body: "not JSON",
      })
    ).status,
  ).toBe(400);
  expect(
    await request("invoke", { action: "projects:create", args: [] }),
  ).toMatchObject({ ok: false });
  expect(
    await request("invoke", {
      action: "dialog:openPage",
      args: { selectedPath: "../../etc/passwd" },
    }),
  ).toMatchObject({ ok: false, error: { code: "INVALID_PATH" } });
  expect((await fetch(server.url + "projects/")).status).toBe(404);
  expect(
    (await fetch(server.url + "assets/%2e%2e%2fagent-runtime.json")).status,
  ).toBe(404);
  await symlink(
    process.platform === "win32" ? home : join(home, "agent-runtime.json"),
    join(bundle, "web/assets/outside.json"),
    process.platform === "win32" ? "junction" : "file",
  );
  expect((await fetch(server.url + "assets/outside.json")).status).toBe(404);
  const html = await fetch(server.url);
  expect(html.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'",
  );
  const preview = await fetch(server.url + "?componentPreview=%7B%7D");
  expect(preview.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  expect(preview.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'self'",
  );
});

test("local directory picker creates folders and explicit --home stays fixed", async () => {
  const folder = await request<{ path: string }>("dialog/mkdir", {
    path: home,
    name: "Selected directory",
  });
  expect(folder.ok).toBe(true);
  const listing = await request<{ entries: { name: string }[] }>(
    "dialog/list",
    { path: home },
  );
  expect(
    listing.ok &&
      listing.data.entries.some((entry) => entry.name === "Selected directory"),
  ).toBe(true);
  expect(
    await request("dialog/mkdir", { path: home, name: "../escape" }),
  ).toMatchObject({ ok: false });
  expect(
    await request("invoke", {
      action: "settings:chooseHome",
      args: { selectedPath: home },
    }),
  ).toMatchObject({ ok: false, error: { code: "INVALID_DATA" } });
});

test("persisted browser content location survives restart and CLI remains usable without a UI server", async () => {
  await server.close();
  const savedHome = join(home, "saved-library");
  await mkdir(savedHome);
  const configPath = join(home, "settings.json");
  await writeFile(configPath, JSON.stringify({ home: savedHome }));
  server = await startBrowserServer({
    webRoot: join(bundle, "web"),
    cliEntry: cli,
    settingsPath: configPath,
  });
  expect(server.home).toBe(savedHome);
  token = JSON.parse(
    (await (await fetch(server.url)).text()).match(
      /window\.__SHOWAI_LOCAL__=(\{[^<]+\})<\/script>/,
    )![1],
  ).token;
  const nextHome = join(home, "new-library");
  await mkdir(nextHome);
  const next = await invoke<DesktopInfo>("settings:chooseHome", {
    selectedPath: nextHome,
  });
  expect(next.home).toBe(await realpath(nextHome));
  expect(JSON.parse(await readFile(configPath, "utf8")).home).toBe(
    await realpath(nextHome),
  );
  await server.close();
  const standalone = await execute(
    next.cli.command,
    [
      ...next.cli.args,
      "projects",
      "create",
      "--name",
      "Offline Agent",
      "--json",
    ],
    { env: { ...process.env, ...next.cli.env } },
  );
  expect(JSON.parse(standalone.stdout).data.name).toBe("Offline Agent");
  server = await startBrowserServer({
    webRoot: join(bundle, "web"),
    cliEntry: cli,
    settingsPath: configPath,
  });
  expect(server.home).toBe(await realpath(nextHome));
});

test("packaged serve command starts, prints its address, serves the full workbench and shuts down cleanly", async () => {
  const child: ChildProcess = spawn(
    process.execPath,
    [cli, "serve", "--home", home, "--no-open", "--json"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let errors = "";
  child.stderr!.on("data", (chunk) => {
    errors += chunk;
  });
  const started = await new Promise<{ url: string }>((done, reject) => {
    let output = "";
    child.stdout!.on("data", (chunk) => {
      output += chunk;
      if (output.includes("\n")) done(JSON.parse(output.split("\n")[0]).data);
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error(`Serve exited ${code}: ${errors}`)),
    );
  });
  try {
    const html = await (await fetch(started.url)).text();
    expect(html).toContain("__SHOWAI_LOCAL__");
    const credential = JSON.parse(
      html.match(/window\.__SHOWAI_LOCAL__=(\{[^<]+\})<\/script>/)![1],
    ).token;
    const exited = new Promise<number | null>((done) =>
      child.once("exit", done),
    );
    const shutdown = await fetch(started.url + "api/shutdown", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential}`,
      },
      body: "{}",
    });
    expect(shutdown.status).toBe(200);
    expect(await exited).toBe(0);
  } finally {
    if (child.exitCode === null) child.kill();
  }
}, 10000);

test("versioned browser bridge attributes human edits and replays a saved request without duplicating content", async () => {
  const library = new GitLibrary(home);
  await library.initialize();
  const project = await invoke<{ id: string }>("projects:create", {
    name: "Versioned browser",
  });
  const createArgs = {
    projectId: project.id,
    title: "Browser report",
    historyContext: { operationId: "browser-create", message: "创建报告" },
  };
  const page = await invoke<LoadedPage>("pages:create", createArgs);
  const saveArgs = {
    projectId: project.id,
    pageId: page.document.id,
    document: { ...page.document, title: "Edited browser report" },
    baseHash: page.hash,
    baseRevision: page.revision,
    historyContext: {
      operationId: "browser-save",
      groupId: "browser-group",
      message: "编辑标题",
    },
  };
  const saved = await invoke<LoadedPage>("pages:save", saveArgs);
  expect(saved.revision).not.toBe(page.revision);
  expect(await invoke<LoadedPage>("pages:save", saveArgs)).toEqual(saved);
  expect(await invoke<LoadedPage>("pages:create", createArgs)).toEqual(page);
  expect(
    await invoke<unknown[]>("pages:list", { projectId: project.id }),
  ).toHaveLength(1);
  expect((await library.history({ limit: 1 }))[0]).toMatchObject({
    actor: { kind: "human" },
    channel: "browser",
    message: "编辑标题",
    groupId: "browser-group",
  });
  await expect(
    invoke("pages:save", {
      ...saveArgs,
      document: { ...saved.document, title: "Other" },
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

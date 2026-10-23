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
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { release, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { startBrowserServer } from "./server";
import { AgentService } from "../agent/service";
import { ContentLibrary as GitLibrary } from "../core/content-library";
import type { LibraryStorage } from "../core/library-maintenance";
import type { DesktopInfo, DesktopResponse } from "../desktop/bridge";
import type { LoadedPage } from "../studio/usePage";
import { blankDocument } from "../core/catalog";
import type { CompiledComponent } from "../components/custom/types";
import type { ProjectMetadata } from "../core/model";
import type { ConnectorSettings } from "../agent-host/remote-connector";

test("remote device settings pass through the authenticated browser boundary", async () => {
  const status = await invoke<{
    settings: ConnectorSettings;
    online: boolean;
    connections: unknown[];
  }>("agent:remoteDevice");
  expect(status.settings.enabled).toBe(false);
  expect(status.online).toBe(false);
  expect(status.connections).toEqual([]);
  await expect(
    invoke("agent:shareDevice", {
      settings: { ...status.settings, enabled: true },
    }),
  ).rejects.toThrow("Choose a signed-in server account");
});

test("project manual order survives workbench page and board saves and appends newly created projects", async () => {
  const a = await invoke<{ id: string }>("projects:create", { name: "First" });
  const b = await invoke<{ id: string }>("projects:create", { name: "Second" });
  const ids = async () =>
    (await invoke<{ id: string }[]>("projects:list")).map((item) => item.id);
  expect(await ids()).toEqual([a.id, b.id]);
  const original = await invoke<ProjectMetadata[]>("projects:list");
  await invoke("sidebar:moveProject", {
    projectId: b.id,
    sectionId: "projects",
    relativeId: a.id,
  });
  expect(await ids()).toEqual([b.id, a.id]);
  const reordered = await invoke<ProjectMetadata[]>("projects:list");
  expect(reordered.find((item) => item.id === b.id)?.updatedAt).toBe(
    original.find((item) => item.id === b.id)?.updatedAt,
  );
  for (const kind of ["page", "board"]) {
    const record = await invoke<LoadedPage>("pages:create", {
      projectId: a.id,
      title: kind,
      kind,
    });
    await invoke("pages:save", {
      projectId: a.id,
      pageId: record.document.id,
      baseHash: record.hash,
      baseRevision: record.revision,
      document: { ...record.document, title: `${kind} edited` },
    });
    expect(await ids()).toEqual([b.id, a.id]);
  }
  const c = await invoke<{ id: string }>("projects:create", { name: "Third" });
  expect(await ids()).toEqual([b.id, a.id, c.id]);
  expect(
    (await invoke<{ projectOrder: string[] }>("sidebar:get")).projectOrder,
  ).toEqual([b.id, a.id, c.id]);
});

test("directory sort choices persist through the real workbench action at the selected folder only", async () => {
  const project = await invoke<{ id: string }>("projects:create", {
    name: "Sort actions",
  });
  const folder = await invoke<{ id: string }>("folders:create", {
    projectId: project.id,
    name: "Folder",
  });
  const other = await invoke<{ id: string }>("folders:create", {
    projectId: project.id,
    name: "Other",
  });
  await invoke("directory:sort", {
    projectId: project.id,
    parentId: null,
    sortBy: "name",
  });
  const saved = await invoke<ProjectMetadata>("directory:sort", {
    projectId: project.id,
    parentId: folder.id,
    sortBy: "createdAt",
  });
  expect(saved.sortBy).toBe("name");
  expect(saved.folders!.find((item) => item.id === folder.id)?.sortBy).toBe(
    "createdAt",
  );
  expect(
    saved.folders!.find((item) => item.id === other.id)?.sortBy,
  ).toBeUndefined();
  const listed = await invoke<ProjectMetadata[]>("projects:list");
  expect(listed.find((item) => item.id === project.id)).toMatchObject(saved);
  await expect(
    invoke("directory:sort", {
      projectId: project.id,
      parentId: folder.id,
      sortBy: "invalid",
    }),
  ).rejects.toMatchObject({ code: "INVALID_DATA" });
});

test(
  "sidebar moves preserve project-local components and export after a cross-project move",
  async () => {
    const a = await invoke<{ id: string }>("projects:create", {
      name: "Drag source",
    });
    const b = await invoke<{ id: string }>("projects:create", {
      name: "Drag destination",
    });
    const component = await invoke<CompiledComponent>(
      "components:createExample",
      { projectId: a.id },
    );
    const compiled = await invoke<CompiledComponent>("components:get", {
      projectId: a.id,
      id: component.id,
      version: component.version,
    });
    const document = { ...blankDocument(), title: "Portable dependency" };
    document.content.content!.push({
      type: "widget",
      attrs: {
        id: "custom-widget",
        kind: "custom",
        data: {
          componentId: compiled.id,
          version: compiled.version,
          integrity: compiled.integrity,
          scope: "project",
          props: compiled.defaultData,
        },
      },
    });
    const page = await invoke<LoadedPage>("pages:create", {
      projectId: a.id,
      document,
    });
    await invoke("sidebar:moveProject", {
      projectId: a.id,
      sectionId: "projects",
      relativeId: b.id,
    });
    const group = (
      await invoke<{ groups: { id: string }[] }>("groups:create", {
        name: "Drag group",
      })
    ).groups[0];
    await invoke("sidebar:moveProject", {
      projectId: a.id,
      sectionId: group.id,
    });
    const folder = await invoke<{ id: string }>("folders:create", {
      projectId: b.id,
      name: "Pages",
    });
    await invoke("sidebar:moveEntry", {
      kind: "page",
      projectId: a.id,
      id: page.document.id,
      destinationProjectId: b.id,
      parentId: folder.id,
      baseHash: page.hash,
      baseRevision: page.revision,
    });
    const moved = await invoke<LoadedPage>("pages:get", {
      projectId: b.id,
      pageId: page.document.id,
    });
    expect(moved.document.id).toBe(page.document.id);
    expect(moved.document.parentId).toBe(folder.id);
    expect(moved.components[0].integrity).toBe(compiled.integrity);
    expect(await invoke("pages:list", { projectId: a.id })).toEqual([]);
    const output = join(home, "moved.html");
    await invoke("export:page", {
      projectId: b.id,
      pageId: page.document.id,
      format: "html",
      selectedPath: output,
    });
    expect(await readFile(output, "utf8")).toContain("custom-widget");
  },
  process.platform === "win32" ? 60000 : 15000,
);

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
  await copyFile(
    join(repository, "dist-agent/index-worker.mjs"),
    join(dirname(cli), "index-worker.mjs"),
  );
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

test("new windows target real projects, folders and pages, and reject unavailable destinations", async () => {
  const project = await invoke<{ id: string }>("projects:create", {
    name: "Window destinations",
  });
  const folder = await invoke<{ id: string }>("folders:create", {
    projectId: project.id,
    name: "Nested destination",
  });
  const page = await invoke<LoadedPage>("pages:create", {
    projectId: project.id,
    parentId: folder.id,
    document: { ...blankDocument(), title: "Window page" },
  });
  for (const args of [
    { projectId: project.id },
    { projectId: project.id, folderId: folder.id },
    { projectId: project.id, pageId: page.document.id },
  ]) {
    const result = await invoke<{ url: string }>("app:openWindow", args);
    const url = new URL(result.url);
    expect(url.origin).toBe(new URL(server.url).origin);
    expect(url.searchParams.get("project")).toBe(project.id);
    expect(url.searchParams.get("folder")).toBe(
      "folderId" in args ? args.folderId : null,
    );
    expect(url.searchParams.get("page")).toBe(
      "pageId" in args ? args.pageId : null,
    );
    expect(url.searchParams.has("focus")).toBe(false);
  }
  const legacy = await invoke<{ url: string }>("app:openPageWindow", {
    projectId: project.id,
    pageId: page.document.id,
  });
  expect(new URL(legacy.url).searchParams.get("page")).toBe(page.document.id);
  expect(new URL(legacy.url).searchParams.has("focus")).toBe(false);
  for (const args of [
    { projectId: project.id, folderId: "missing-folder" },
    { projectId: project.id, pageId: "missing-page" },
    { projectId: "missing-project" },
    { projectId: project.id, folderId: folder.id, pageId: page.document.id },
    { projectId: project.id, folderId: "../outside" },
  ]) {
    const result = await request("invoke", { action: "app:openWindow", args });
    expect(result.ok).toBe(false);
  }
});

test("workbench project creation accepts empty, emoji and embedded image icons and retains them across reads", async () => {
  const created = await invoke<{ id: string }>("projects:create", {
    name: "With icon",
    icon: "🧪",
  });
  const blank = await invoke<{ id: string }>("projects:create", {
    name: "Without icon",
    icon: "",
  });
  const image =
    "data:image/png;base64," +
    (await readFile(join(repository, "src/desktop/assets/icon.png"))).toString(
      "base64",
    );
  expect(image.length).toBeGreaterThan(10000);
  const imageProject = await invoke<{ id: string }>("projects:create", {
    name: "Created image icon",
    icon: image,
  });
  await invoke("projects:rename", {
    projectId: created.id,
    name: "Image icon",
    icon: image,
  });
  let projects = await invoke<{ id: string; icon?: string }[]>("projects:list");
  expect(projects.find((item) => item.id === created.id)?.icon).toBe(image);
  expect(projects.find((item) => item.id === imageProject.id)?.icon).toBe(
    image,
  );
  expect(projects.find((item) => item.id === blank.id)?.icon).toBe("");
  await invoke("projects:rename", {
    projectId: created.id,
    name: "Cleared",
    icon: "",
  });
  projects = await invoke<{ id: string; icon?: string }[]>("projects:list");
  expect(projects.find((item) => item.id === created.id)?.icon).toBe("");
});

test("workbench folder actions accept, keep, replace, clear and reject folder icons", async () => {
  const project = await invoke<{ id: string }>("projects:create", {
    name: "Folder icon actions",
  });
  const folder = await invoke<{ id: string; icon?: string }>("folders:create", {
    projectId: project.id,
    name: "Iconic",
    icon: "📚",
  });
  expect(folder.icon).toBe("📚");
  const plain = await invoke<{ id: string; icon?: string }>("folders:create", {
    projectId: project.id,
    name: "Plain",
  });
  expect(plain.icon).toBeUndefined();
  const listIcon = async (id: string) =>
    (
      await invoke<{ id: string; icon?: string }[]>("folders:list", {
        projectId: project.id,
      })
    ).find((item) => item.id === id)?.icon;
  await invoke("folders:rename", {
    projectId: project.id,
    folderId: folder.id,
    name: "Renamed only",
  });
  expect(await listIcon(folder.id)).toBe("📚");
  await invoke("folders:rename", {
    projectId: project.id,
    folderId: folder.id,
    name: "Image",
    icon: "https://example.com/folder.png",
  });
  expect(await listIcon(folder.id)).toBe("https://example.com/folder.png");
  for (const icon of ["javascript:alert(1)", "x".repeat(65), 7]) {
    const result = await request("invoke", {
      action: "folders:rename",
      args: {
        projectId: project.id,
        folderId: folder.id,
        name: "Bad",
        icon,
      },
    });
    expect(result.ok).toBe(false);
    const created = await request("invoke", {
      action: "folders:create",
      args: { projectId: project.id, name: "Bad", icon },
    });
    expect(created.ok).toBe(false);
  }
  expect(await listIcon(folder.id)).toBe("https://example.com/folder.png");
  await invoke("folders:rename", {
    projectId: project.id,
    folderId: folder.id,
    name: "Cleared",
    icon: "",
  });
  expect(await listIcon(folder.id)).toBe("");
  expect(
    (
      await invoke<{ name: string }[]>("folders:list", {
        projectId: project.id,
      })
    )
      .map((item) => item.name)
      .sort(),
  ).toEqual(["Cleared", "Plain"]);
});

test("browser workbench, standalone CLI and a second client share real files and preserve conflicts", async () => {
  const info = await invoke<DesktopInfo>("app:info");
  expect(info.mode).toBe("browser");
  expect(info.cli.args).toEqual([cli]);
  // The browser host reports the macOS product version, as the desktop app does.
  if (process.platform === "darwin")
    expect(info.osVersion).not.toBe(release());
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
    baseRevision: original.revision,
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
    "--base-revision",
    saved.revision!,
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
      baseRevision: saved.revision,
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

test("local media plays only through grants minted by the authenticated workbench", async () => {
  const clip = join(home, "clip.mp4");
  await writeFile(clip, "0123456789");
  const grant = await invoke<{ token: string; kind: string; path: string }>(
    "media:open",
    { path: `file://${clip}` },
  );
  expect(grant.kind).toBe("video");
  const media = server.url + "api/media/" + grant.token;
  const whole = await fetch(media);
  expect(whole.status).toBe(200);
  expect(whole.headers.get("content-type")).toBe("video/mp4");
  expect(await whole.text()).toBe("0123456789");
  const part = await fetch(media, { headers: { Range: "bytes=3-4" } });
  expect(part.status).toBe(206);
  expect(part.headers.get("content-range")).toBe("bytes 3-4/10");
  expect(await part.text()).toBe("34");
  // Unknown tokens, foreign origins and other methods never reach the file.
  expect((await fetch(server.url + "api/media/" + crypto.randomUUID())).status).toBe(404);
  expect(
    (await fetch(media, { headers: { Origin: "https://example.com" } })).status,
  ).toBe(403);
  expect((await fetch(media, { method: "POST" })).status).toBe(401);
  await expect(invoke("media:open", { path: "clip.mp4" })).rejects.toMatchObject({
    code: "INVALID_PATH",
  });
  await expect(invoke("media:reveal", { token: crypto.randomUUID() })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  // The workbench page allows same-origin media for the player.
  expect((await fetch(server.url)).headers.get("content-security-policy")).toContain(
    "media-src 'self'",
  );
});

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
  const scriptPolicy = html.headers.get("content-security-policy")!.split(";").find(directive => directive.trim().startsWith("script-src "))!.trim().split(/\s+/);
  expect(scriptPolicy).toContain("'wasm-unsafe-eval'");
  expect(scriptPolicy).not.toContain("'unsafe-eval'");
  const workerPolicy=html.headers.get("content-security-policy")!.split(";").find(directive=>directive.trim().startsWith("worker-src "))!.trim().split(/\s+/);
  expect(workerPolicy).toEqual(["worker-src","'self'"]);
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

test("storage bridge analyzes project folders on demand in an isolated versioned library", async () => {
  const library = new GitLibrary(home);
  await library.initialize();
  const project = await invoke<{ id: string }>("projects:create", {
    name: "Project space",
  });
  const head = await library.head();
  expect(
    (await invoke<LibraryStorage>("library:storage")).projects,
  ).toBeUndefined();
  const result = await invoke<LibraryStorage>("library:storage", {
    projects: true,
  });
  expect(result.projects?.items).toHaveLength(1);
  expect(result.projects?.items[0]).toMatchObject({
    id: project.id,
    name: "Project space",
    retained: false,
  });
  expect(result.projects!.items[0].bytes + result.projects!.shared.bytes).toBe(
    result.totalBytes,
  );
  expect(await library.head()).toBe(head);
});

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
  await expect(
    invoke<LoadedPage>("pages:create", createArgs),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await invoke<unknown[]>("pages:list", { projectId: project.id }),
  ).toHaveLength(1);
  expect(await library.entryAt(saved.revision!)).toMatchObject({
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

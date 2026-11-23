import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { WorkbenchBundle, WorkbenchChanges, WorkbenchMediaChunk } from "../host/codex-workbench-transport";
import type { DesktopResponse } from "../host/protocol";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import { readingBrowserExecutable } from "./reading-renderer";
import { codexWorkbenchUri, codexWorkbenchThreadUri, codexWorkbenchFileUri, codexWorkbenchCardUri, codexWorkbenchTargetUri } from "./codex-workbench-ui";
import { codexPageReferenceExtension, codexWorkbenchPageLink, type CodexPageTarget } from "./codex-page-reference";
import type { ShowDocument } from "../types";

type SavedPage = { document: ShowDocument; hash: string; revision?: string };

it("addresses the installed global Workbench with the Page and optional component in its relative path", () => {
  const entry = "codex://plugins/showai-workbench-test@showai-workbench-test/app/workbench_open_global";
  const page = { projectId: "project-1", pageId: "page-2" };
  for (const blockId of [undefined, "block-3"]) {
    const url = new URL(codexWorkbenchPageLink(entry, { ...page, blockId }));
    expect(url.href.split("?")[0]).toBe(entry);
    expect(url.searchParams.size).toBe(1);
    expect(url.searchParams.get("path")).toBe("/?project=project-1&page=page-2" + (blockId ? "&blocks=block-3" : ""));
  }
});

async function workbenchTool<T>(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  expect(result.content).toEqual([]);
  return result._meta!.showaiWorkbenchData as T;
}

async function checkCardClicks(html: string, metadata: Record<string, unknown>, target: CodexPageTarget) {
  const browser = await chromium.launch({ executablePath: await readingBrowserExecutable() });
  try {
    for (const trigger of ["title", "label", "workbench", "desktop"] as const) {
      const page = await browser.newPage({
        locale: "zh-CN", colorScheme: trigger === "desktop" ? "dark" : "light",
        viewport: { width: trigger === "title" ? 640 : 320, height: 700 },
      });
      await page.setContent('<iframe style="display:block;width:100%;height:650px;border:0"></iframe><output hidden></output>');
      await page.evaluate(({ html, metadata }) => {
        const frame = document.querySelector("iframe")!;
        const send = (message: object) => frame.contentWindow!.postMessage({ jsonrpc: "2.0", ...message }, "*");
        window.addEventListener("message", ({ source, data }) => {
          if (source !== frame.contentWindow || data?.jsonrpc !== "2.0") return;
          if (data.method === "ui/initialize") send({ id: data.id, result: {
            protocolVersion: data.params.protocolVersion, hostInfo: { name: "card-test", version: "1" },
            hostCapabilities: { serverTools: {} }, hostContext: { displayMode: "inline", locale: "zh-CN" },
          } });
          if (data.method === "ui/notifications/initialized")
            send({ method: "ui/notifications/tool-result", params: { _meta: metadata } });
          if (data.method === "tools/call") document.querySelector("output")!.value = JSON.stringify(data.params);
        });
        frame.srcdoc = html;
      }, { html, metadata });

      const list = page.frameLocator("iframe").locator("#showai-page-card");
      const card = list.getByRole("article").nth(1);
      const label = card.getByText("侧边打开", { exact: true });
      const toggle = card.getByRole("button", { name: "选择打开方式" });
      await label.waitFor({ timeout: 5000 });
      const labelBox = (await label.boundingBox())!;
      const toggleBox = (await toggle.boundingBox())!;
      expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(toggleBox.x);
      expect(Math.abs(labelBox.y + labelBox.height / 2 - toggleBox.y - toggleBox.height / 2)).toBeLessThan(2);

      const isMenu = trigger === "workbench" || trigger === "desktop";
      let action = trigger === "label" ? label : card.getByRole("heading");
      if (isMenu) {
        if (trigger === "workbench") await toggle.click();
        else await toggle.press("ArrowDown");
        const items = card.getByRole("menuitem");
        expect((await items.allTextContents()).map(text => text.trim())).toEqual(["从工作台打开", "从 ShowAI App 打开"]);
        action = card.locator(`[data-destination="${trigger}"]`);
      }
      if (process.env.SHOWAI_SMOKE_OUTPUT)
        await list.screenshot({ path: join(process.env.SHOWAI_SMOKE_OUTPUT, `codex-card-${trigger}.png`) });
      // The full-card button receives clicks at the position of the title or label.
      await action.click({ force: !isMenu });
      const request = page.locator("output");
      await expect.poll(async () => JSON.parse(await request.textContent() || "null")).toMatchObject({
        name: isMenu ? "workbench_open_destination" : "card_navigate",
        arguments: isMenu ? { ...target, destination: trigger } : target,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

it("opens both Codex workbench entries and saves into the MCP library", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-codex-workbench-"));
  const home = join(root, "library");
  const client = new Client({ name: "ShowAI workbench test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist-agent/cli.mjs"), "mcp", "--home", home],
    env: {
      SHOWAI_CODEX_WORKBENCH_PROFILE: join(root, "profile"),
      SHOWAI_CODEX_PLUGIN_ID: "showai-workbench-test@showai-workbench-test",
    },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    expect(client.getServerVersion()?.icons).toEqual(
      ["light", "dark"].map((theme) => ({
        src: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
        mimeType: "image/svg+xml",
        sizes: ["any"],
        theme,
      })),
    );
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "workbench_open_global")?._meta).toMatchObject({
      ui: { resourceUri: codexWorkbenchUri, visibility: ["app"] },
      "openai/ui": { entrypoints: [{ type: "global" }] },
    });
    expect(tools.find((tool) => tool.name === "workbench_open")?._meta).toEqual({
      ui: { resourceUri: "ui://showai/workbench.html", visibility: ["app"] },
    });
    expect(tools.find((tool) => tool.name === "workbench_open_page")?._meta).toMatchObject({
      ui: { resourceUri: codexWorkbenchThreadUri, visibility: ["app"] },
      "openai/ui": { entrypoints: [{ type: "thread" }] },
    });
    expect(tools.find((tool) => tool.name === "workbench_open_file")?._meta).toMatchObject({
      ui: { resourceUri: codexWorkbenchFileUri, visibility: ["app"] },
      "openai/ui": { entrypoints: [{ type: "file", extensions: [codexPageReferenceExtension, ".showai-test-ref"] }] },
    });
    for (const name of ["card_present", "workbench_page_reference"]) {
      expect(tools.find((tool) => tool.name === name)?._meta?.ui)
        .toEqual({ resourceUri: codexWorkbenchCardUri, visibility: ["model", "app"] });
    }
    const cardResource = await client.readResource({ uri: codexWorkbenchCardUri });
    for (const version of [5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      const previous = await client.readResource({ uri: `ui://showai/workbench-card-v${version}.html` });
      expect(previous.contents[0].mimeType).toBe("text/html;profile=mcp-app");
    }
    const [cardContent] = cardResource.contents;
    if (!("text" in cardContent)) throw new Error("Expected a card HTML resource");
    const cardHtml = cardContent.text;
    expect(cardHtml).toContain('aria-haspopup="menu"');
    for (const destination of ["workbench", "desktop"])
      expect(cardHtml).toContain(`data-destination="${destination}"`);
    expect(cardHtml).not.toContain("<select");
    expect(cardHtml).not.toContain("__CHATGPT_ICON__");
    expect(tools.find(tool => tool.name === "workbench_open_destination")?._meta?.ui)
      .toEqual({ visibility: ["app"] });
    expect(cardResource.contents[0]).toMatchObject({
      mimeType: "text/html;profile=mcp-app",
      text: expect.stringContaining('id="showai-page-card"'),
      _meta: {
        "openai/widgetMinFrameHeight": 0,
        "openai/ui": { availableDisplayModes: ["inline"], preferredDisplayMode: "inline" },
      },
    });
    expect(cardHtml).not.toContain('"ui/request-display-mode"');
    expect(cardHtml).toContain('"openai/files/open"');
    expect(cardResource.contents[0]).toHaveProperty("text", expect.stringContaining(
      "const hasGlobalEntrypoint = true",
    ));
    const direct = await client.readResource({ uri: codexWorkbenchTargetUri });
    expect(direct.contents[0]._meta?.["openai/ui"]).toMatchObject({ preferredDisplayMode: "fullscreen" });
    expect(direct.contents[0]._meta?.["openai/widgetMinFrameHeight"]).toBe(0);
    const fileResource = await client.readResource({ uri: codexWorkbenchFileUri });
    expect(fileResource.contents[0]).toMatchObject({
      mimeType: "text/html;profile=mcp-app",
      text: expect.stringContaining("const useFileEntrypoint = true"),
    });
    expect(tools.find((tool) => tool.name === "show_component")?._meta?.ui)
      .toEqual({ resourceUri: "ui://showai/component-v3.html" });

    const resource = await client.readResource({ uri: codexWorkbenchUri });
    expect(resource.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
    expect(resource.contents[0]).toHaveProperty("text", expect.stringContaining("ui/update-model-context"));
    const open = async (name: string) => {
      const result = await client.callTool({ name, arguments: {} });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return new URL((result._meta!.showaiWorkbench as { url: string }).url);
    };
    const globalUrl = await open("workbench_open_global");
    const threadUrl = await open("workbench_open_page");
    expect(globalUrl.origin).toBe(threadUrl.origin);
    expect(globalUrl.searchParams.get("codexMode")).toBe("global");
    expect(threadUrl.searchParams.get("codexMode")).toBe("thread");
    expect(resource.contents[0]._meta).toMatchObject({
      ui: { csp: {
        resourceDomains: ["blob:", "data:"],
        frameDomains: ["blob:", "data:"],
      } },
    });
    expect(resource.contents[0]._meta?.ui).not.toHaveProperty("csp.connectDomains");
    const boot = await client.callTool({ name: "workbench_refresh", arguments: { mode: "global" } });
    expect(boot.isError).not.toBe(true);
    const bundle = (boot._meta?.showaiWorkbench as { bundle: WorkbenchBundle }).bundle;
    const entryPart = await workbenchTool<string>(client, "workbench_asset", {
      name: bundle.entry, offset: 0,
    });
    expect(Buffer.from(entryPart, "base64").length).toBeGreaterThan(0);
    const badAsset = await client.callTool({ name: "workbench_asset", arguments: { name: "outside", offset: 0 } });
    expect(badAsset.isError).toBe(true);
    const denied = await fetch(threadUrl.origin);
    expect(denied.status).toBe(403);

    const origin = "codex-sandbox://web-sandbox.oaiusercontent.com";
    const allowed = await fetch(new URL("/api/invoke", threadUrl), {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Headers": "Authorization, Content-Type" },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(origin);
    for (const forbiddenOrigin of [
      "https://outside.example",
      "codex-sandbox://web-sandbox.oaiusercontent.com.outside.example",
      "codex-sandbox://web-sandbox.oaiusercontent.com:8080",
      "null",
    ]) {
      const forbidden = await fetch(threadUrl, { headers: { Origin: forbiddenOrigin } });
      expect(forbidden.status).toBe(403);
    }

    const bootstrap = await fetch(threadUrl, { headers: { Origin: origin } });
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.headers.get("access-control-allow-origin")).toBe(origin);
    expect(bootstrap.headers.get("x-frame-options")).toBeNull();
    expect(bootstrap.headers.get("content-security-policy")).toContain("frame-ancestors 'self' app:");
    const html = await bootstrap.text();
    const config = JSON.parse(/window\.__SHOWAI_LOCAL__=(\{[^<]+\})<\/script>/.exec(html)![1]);
    expect(config.codexWorkbench.mode).toBe("thread");
    expect(html).toContain('type="module"');
    const unauthorized = await fetch(new URL("/api/invoke", threadUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "app:info", args: {} }),
    });
    expect(unauthorized.status).toBe(401);

    async function invoke<T>(action: string, args: object = {}) {
      const response = await fetch(new URL("/api/invoke", threadUrl), {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ action, args }),
      });
      const result = await response.json();
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      return result.data as T;
    }

    expect(await invoke("app:info")).toMatchObject({ home, mode: "browser" });
    await expect(readFile(join(home, "agent-runtime.json"))).rejects.toHaveProperty("code", "ENOENT");

    const project = await client.callTool({ name: "project_create", arguments: { name: "Codex Workbench" } });
    expect(project.isError, JSON.stringify(project.content)).not.toBe(true);
    const { id: projectId } = (project.structuredContent as { data: { id: string } }).data;
    const folder = await invoke<{ id: string }>("folders:create", { projectId, name: "Plans" });
    const nested = await invoke<{ id: string }>("folders:create", { projectId, name: "Details", parentId: folder.id });
    const page = await invoke<SavedPage>("pages:create", { projectId, title: "Architecture", parentId: nested.id });
    const pageId = page.document.id;
    const savedResult = await workbenchTool<DesktopResponse<SavedPage>>(client, "workbench_request", {
      route: "invoke", client: "codex-workbench-test",
      args: {
        action: "pages:save",
        args: {
          projectId, pageId,
          document: { ...page.document, title: "Edited in workbench" },
          baseHash: page.hash,
          baseRevision: page.revision,
        },
      },
    });
    expect(savedResult.ok).toBe(true);
    if (!savedResult.ok) throw new Error(savedResult.error.message);
    const saved = savedResult.data;
    expect(saved.hash).not.toBe(page.hash);
    const localMedia = join(root, "local.png");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1sAAAAASUVORK5CYII=", "base64");
    await writeFile(localMedia, png);
    const grant = await invoke<{ token: string }>("media:resolve", { ref: pathToFileURL(localMedia).href, kind: "image" });
    const media = await workbenchTool<WorkbenchMediaChunk>(client, "workbench_media", { grant: grant.token, offset: 0 });
    expect(media).toMatchObject({ mime: "image/png", size: png.length, base64: png.toString("base64") });
    const reference = await invoke("pages:reference", {
      projectId,
      pageId,
      target: { kind: "page", pageId },
      expectedHash: saved.hash,
    });
    expect(reference).toMatchObject({ type: "showai.reference", projectId, pageId, hash: saved.hash });
    const fromMcp = await client.callTool({
      name: "page_read",
      arguments: { projectId, pageId, response: "source" },
    });
    expect(fromMcp.isError, JSON.stringify(fromMcp.content)).not.toBe(true);
    expect(fromMcp.structuredContent).toMatchObject({
      data: { document: { id: pageId, title: "Edited in workbench" }, hash: saved.hash },
    });
    const referenceFile = await client.callTool({
      name: "workbench_page_reference",
      arguments: { projectId, pageId },
    });
    expect(referenceFile.isError, JSON.stringify(referenceFile.content)).not.toBe(true);
    const data = (referenceFile.structuredContent as {
      data: { path: string; title: string; projectId: string; pageId: string };
    }).data;
    expect(data).toMatchObject({ title: "Edited in workbench", projectId, pageId });
    expect(referenceFile._meta?.showaiPageCard)
      .toEqual(data);
    expect(data.path.endsWith(codexPageReferenceExtension)).toBe(true);
    expect(referenceFile.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "resource_link", uri: pathToFileURL(data.path).href }),
    ]));
    const source = await readFile(data.path, "utf8");
    expect(JSON.parse(source)).toEqual({
      format: "showai-page-reference", version: 1, projectId, pageId,
    });
    const card = await client.callTool({ name: "card_present", arguments: { projectId, pageId } });
    expect(card.isError).not.toBe(true);
    const breadcrumb = ["Codex Workbench", "Plans", "Details", data.title];
    expect(card.structuredContent).toEqual({
      ok: true, data: { projectId, pageId, title: data.title, breadcrumb },
    });
    expect(card._meta?.showaiPageCard).toEqual({ projectId, pageId, title: data.title, breadcrumb });
    const desktopCard = await client.callTool({ name: "card_present", arguments: { projectId, pageId, openIn: "desktop" } });
    expect(desktopCard._meta).toMatchObject({ showaiCardDestination: "desktop", showaiPageCard: { projectId, pageId } });
    expect(card.content).toHaveLength(1);
    const blockId = saved.document.content.attrs!.id as string;
    const component = { projectId, pageId, blockId };
    const sideFile = await workbenchTool<string>(client, "workbench_side_file", component);
    expect(sideFile.endsWith(".showai-test-ref")).toBe(true);
    expect(await workbenchTool(client, "workbench_resolve_reference", { source: await readFile(sideFile, "utf8") })).toEqual(component);
    const tuning = await client.callTool({
      name: "card_present", arguments: { projectId, pageId, additionalTargets: [component], adjustSpacing: true },
    });
    expect(tuning._meta?.showaiCardGroup).toMatchObject({ adjustSpacing: true, cards: [{ pageId }, { blockId }] });
    const annotated = await client.callTool({
      name: "card_present", arguments: { ...component, description: "  Compare the two dates  " },
    });
    expect(annotated._meta?.showaiPageCard).toMatchObject({
      title: data.title, breadcrumb, blockId, blockTitle: expect.any(String), description: "Compare the two dates",
    });
    const missingDesktop = await client.callTool({
      name: "workbench_open_destination", arguments: { ...component, destination: "desktop", blockId: "deleted-block" },
    });
    expect(missingDesktop.isError).toBe(true);
    const anchored = await client.callTool({ name: "workbench_page_reference", arguments: component });
    const anchoredData = anchored._meta!.showaiPageCard as { path: string };
    const anchorFile = await readFile(anchoredData.path, "utf8");
    expect(JSON.parse(anchorFile)).toEqual({ format: "showai-page-reference", version: 2, ...component });
    expect(await workbenchTool(client, "workbench_resolve_reference", { source: anchorFile })).toEqual(component);
    const show = await client.callTool({ name: "card_open", arguments: component, _meta: { threadId: "first" } });
    expect(show._meta?.showaiPageCard).toMatchObject(component);
    expect(show._meta?.showaiNavigationScope).toEqual(expect.any(String));
    expect(show.content).toEqual([expect.objectContaining({ type: "text" })]);
    const lost = await client.callTool({ name: "card_present", arguments: { ...component, blockId: "deleted-block" } });
    expect(lost.isError).toBe(true);
    const other = await invoke<SavedPage>("pages:create", { projectId, title: "A separate Codex tab" });
    const otherPage = { projectId, pageId: other.document.id };
    const grouped = await client.callTool({
      name: "card_present",
      arguments: { projectId, pageId, description: "This week's agenda",
        additionalTargets: [component, { ...otherPage, description: "Next steps" }] },
    });
    expect(grouped.isError).not.toBe(true);
    const group = grouped._meta!.showaiCardGroup as { id: string; cards: CodexPageTarget[] };
    expect(grouped.structuredContent).toEqual({ ok: true, data: group });
    expect(group.cards).toHaveLength(3);
    expect(group.cards).toMatchObject([
      { projectId, pageId, breadcrumb, description: "This week's agenda" },
      { ...component, title: data.title, breadcrumb, blockTitle: expect.any(String) },
      { ...otherPage, breadcrumb: ["Codex Workbench", "A separate Codex tab"], description: "Next steps" },
    ]);
    expect(group.cards[1]).not.toHaveProperty("description");
    expect(group.cards[0]).not.toHaveProperty("blockId");
    await checkCardClicks(cardHtml, grouped._meta!, component);
    const choice = { groupId: group.id };
    expect(await workbenchTool(client, "workbench_card_choice", choice)).toBeNull();
    await workbenchTool(client, "workbench_card_choice", { ...choice, index: 2 });
    expect(await workbenchTool(client, "workbench_card_choice", choice)).toBe(2);
    const incomplete = await client.callTool({
      name: "card_present",
      arguments: { projectId, pageId, additionalTargets: [{ ...component, blockId: "missing-block" }] },
    });
    expect(incomplete.isError).toBe(true);
    expect(incomplete._meta?.showaiCardGroup).toBeUndefined();
    const poll = async (threadId: string, opened: CodexPageTarget, acknowledged?: string, visible = true) => {
      const result = await client.callTool({ name: "workbench_changes", _meta: { threadId }, arguments: {
        after: -1, client: "editor-" + opened.pageId, panel: {
          page: { projectId: opened.projectId, pageId: opened.pageId }, visible, acknowledged,
        },
      } });
      return (result._meta!.showaiWorkbenchData as { navigation?: { id: string; target: CodexPageTarget } }).navigation;
    };
    const jump = (threadId: string, target: CodexPageTarget) => client.callTool({
      name: "card_navigate", arguments: target, _meta: { threadId },
    });
    await poll("first", component);
    expect((await jump("second", component)).structuredContent).toMatchObject({ data: { status: "unavailable" } });
    expect((await jump("first", otherPage)).structuredContent).toMatchObject({ data: { status: "unavailable" } });
    await poll("first", otherPage);
    const navigating = jump("first", component);
    let navigation: Awaited<ReturnType<typeof poll>>;
    await expect.poll(async () => !!(navigation = await poll("first", component))).toBe(true);
    expect(navigation!.target).toEqual(component);
    expect(await poll("first", otherPage)).toBeUndefined();
    expect(await poll("second", component)).toBeUndefined();
    await poll("first", component, navigation!.id);
    expect((await navigating).structuredContent).toMatchObject({ data: { status: "accepted" } });
    await poll("first", component, undefined, false);
    expect((await jump("first", component)).structuredContent).toMatchObject({ data: { status: "unavailable" } });
    const navigatingOther = jump("first", otherPage);
    await expect.poll(async () => !!(navigation = await poll("first", otherPage))).toBe(true);
    expect(navigation!.target).toEqual(otherPage);
    await poll("first", otherPage, navigation!.id);
    expect((await navigatingOther).structuredContent).toMatchObject({ data: { status: "accepted" } });
    const fileLaunch = await client.callTool({
      name: "workbench_open_file",
      arguments: {
        file: { name: "ShowAI - Edited in workbench.showai-ref", resourceUri: "host-resource://reference-file" },
      },
    });
    expect(fileLaunch.isError, JSON.stringify(fileLaunch.content)).not.toBe(true);
    const fileUrl = new URL((fileLaunch._meta!.showaiWorkbench as { url: string }).url);
    expect(fileUrl.searchParams.get("codexMode")).toBe("thread");
    expect(fileUrl.origin).toBe(threadUrl.origin);
    expect(await workbenchTool(client, "workbench_resolve_reference", { source }))
      .toEqual({ projectId, pageId });
    for (const invalid of [
      "{",
      JSON.stringify({ ...JSON.parse(source), version: 2 }),
      JSON.stringify({ ...JSON.parse(source), pageId: "not-a-saved-page" }),
      JSON.stringify({ ...JSON.parse(source), projectId: "../another-library" }),
    ]) {
      const rejected = await client.callTool({
        name: "workbench_resolve_reference", arguments: { source: invalid },
      });
      expect(rejected.isError).toBe(true);
    }
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it("preserves the shared Board version and a conflicting draft when a Codex pane reconnects", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-codex-workbench-recovery-"));
  const home = join(root, "library");
  const origin = "https://web-sandbox.oaiusercontent.com";
  const connections = new Set<Client>();
  const events = new AbortController();

  async function open(tool: string, profile: string) {
    const client = new Client({ name: "ShowAI workbench recovery test", version: "1" });
    connections.add(client);
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [join(process.cwd(), "dist-agent/cli.mjs"), "mcp", "--home", home],
      env: { SHOWAI_CODEX_WORKBENCH_PROFILE: join(root, profile) },
      stderr: "pipe",
    }));
    const launch = await client.callTool({ name: tool, arguments: {} });
    expect(launch.isError, JSON.stringify(launch.content)).not.toBe(true);
    const url = new URL((launch._meta!.showaiWorkbench as { url: string }).url);
    const bootstrap = await fetch(url, { headers: { Origin: origin } });
    expect(bootstrap.status).toBe(200);
    const html = await bootstrap.text();
    const { token } = JSON.parse(/window\.__SHOWAI_LOCAL__=(\{[^<]+\})<\/script>/.exec(html)![1]);

    async function request(action: string, args: object) {
      return fetch(new URL("/api/invoke", url), {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, args }),
      });
    }

    async function invoke<T>(action: string, args: object) {
      const result = await (await request(action, args)).json();
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      return result.data as T;
    }

    return { client, url, token, request, invoke };
  }

  try {
    const global = await open("workbench_open_global", "global-profile");
    const thread = await open("workbench_open_page", "thread-profile");
    expect(global.url.origin).not.toBe(thread.url.origin);
    const project = await global.invoke<{ id: string }>("projects:create", { name: "Concurrent workbench edits" });
    const projectId = project.id;
    const board = await global.invoke<SavedPage>("pages:create", { projectId, title: "Board baseline", kind: "board" });
    const pageId = board.document.id;
    const scope = { projectId, pageId };
    expect((await thread.invoke<SavedPage>("pages:get", scope)).hash).toBe(board.hash);
    const local = { ...board.document, title: "Thread draft" };
    const draft = await thread.invoke<{ id: string }>("drafts:save", {
      input: {
        kind: "page",
        clientId: "thread-editor",
        projectId,
        resourceId: pageId,
        baseRevision: board.revision,
        baseContent: board.document,
        content: local,
        sequence: 1,
      },
    });

    const { cursor: before } = await workbenchTool<WorkbenchChanges>(thread.client, "workbench_changes", {
      after: -1, client: "thread-editor",
    });
    const url = new URL("/api/events", thread.url);
    url.searchParams.set("token", thread.token);
    url.searchParams.set("client", "thread-editor");
    const response = await fetch(url, {
      headers: { Origin: origin },
      signal: AbortSignal.any([events.signal, AbortSignal.timeout(7000)]),
    });
    expect(response.status).toBe(200);
    const stream = response.body!.getReader();
    const decoder = new TextDecoder();
    let pending = decoder.decode((await stream.read()).value, { stream: true });
    expect(pending).toContain('"type":"files"');

    const written = await global.invoke<SavedPage>("pages:save", {
      ...scope,
      document: { ...board.document, title: "Global saved" },
      baseHash: board.hash,
      baseRevision: board.revision,
    });
    let sawBoardChange = false;
    while (!sawBoardChange) {
      const event = await stream.read();
      if (event.done) throw new Error("Workbench change stream ended before the Board update.");
      pending += decoder.decode(event.value, { stream: true });
      const messages = pending.split("\n\n");
      pending = messages.pop()!;
      sawBoardChange = messages.some(message => {
        if (!message.startsWith("data: ")) return false;
        const update = JSON.parse(message.slice("data: ".length));
        return update.home === home && update.pageIds?.includes(pageId);
      });
    }
    await stream.cancel();
    const updates = await workbenchTool<WorkbenchChanges>(thread.client, "workbench_changes", {
      after: before, client: "thread-editor",
    });
    expect(updates.changes.some((change) => change.home === home && change.pageIds?.includes(pageId))).toBe(true);

    const stale = await thread.request("pages:save", {
      ...scope,
      document: local,
      baseHash: board.hash,
      baseRevision: board.revision,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ ok: false, error: { code: "CONFLICT" } });

    await thread.client.close();
    connections.delete(thread.client);
    await expect(fetch(thread.url)).rejects.toThrow();
    const reopened = await open("workbench_open_page", "thread-profile");
    const resource = await reopened.client.readResource({ uri: codexWorkbenchThreadUri });
    const refresh = await reopened.client.callTool({
      name: "workbench_refresh",
      arguments: { mode: "thread" },
    });
    expect(refresh.isError, JSON.stringify(refresh.content)).not.toBe(true);
    const freshUrl = new URL((refresh._meta!.showaiWorkbench as { url: string }).url);
    expect(freshUrl.origin).toBe(reopened.url.origin);
    expect(freshUrl.origin).not.toBe(thread.url.origin);
    expect(freshUrl.searchParams.get("codexMode")).toBe("thread");
    expect(resource.contents[0]).toHaveProperty(
      "text",
      expect.stringContaining('name: "workbench_refresh"'),
    );
    expect(resource.contents[0]).not.toHaveProperty(
      "text",
      expect.stringContaining(freshUrl.searchParams.get("codexWorkbench")!),
    );
    const current = await reopened.invoke<SavedPage>("pages:get", scope);
    expect(current).toMatchObject({ hash: written.hash, revision: written.revision, document: { title: "Global saved" } });
    expect(await reopened.invoke("drafts:read", { id: draft.id })).toMatchObject({
      record: { projectId, resourceId: pageId, baseRevision: board.revision },
      content: { title: "Thread draft" },
      baseContent: { title: "Board baseline" },
    });
    const preview = await reopened.invoke<{
      conflicts: unknown[];
      document: ShowDocument;
      currentRevision: string;
    }>("page:mergePreview", {
      ...scope,
      baseRevision: board.revision,
      document: { ...board.document, icon: "🧭" },
    });
    expect(preview.conflicts).toEqual([]);
    expect(preview.document).toMatchObject({ title: "Global saved", icon: "🧭" });
    const merged = await reopened.invoke<SavedPage>("page:mergeSave", {
      ...scope,
      baseRevision: board.revision,
      currentRevision: preview.currentRevision,
      document: preview.document,
    });
    const fromMcp = await global.client.callTool({
      name: "page_read",
      arguments: { ...scope, response: "source" },
    });
    expect(fromMcp.isError, JSON.stringify(fromMcp.content)).not.toBe(true);
    expect(fromMcp.structuredContent).toMatchObject({
      data: { hash: merged.hash, document: { id: pageId, title: "Global saved", icon: "🧭" } },
    });
  } finally {
    events.abort();
    await Promise.all([...connections].map(client => client.close()));
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

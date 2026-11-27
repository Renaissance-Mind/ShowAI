import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, test } from "vitest";
import { chromium } from "playwright-core";
import { readingBrowserExecutable } from "./reading-renderer";
import { mountWorkbenchCards } from "../test/workbench-card-frame";

test.each(["mcp-app", "model-html", "fragment-file", "t3-html"])(
  "delivers a real saved Page in %s and opens its attached workbench",
  async display => {
    const home = await mkdtemp(join(tmpdir(), "showai-linked-workbench-"));
    const client = new Client({ name: "showai-linked-workbench-test", version: "1" });
    try {
      await client.connect(new StdioClientTransport({
        command: process.execPath,
        args: [join(process.cwd(), "dist-agent/cli.mjs"), "mcp", "--home", home],
        env: { SHOWAI_LINKED_WORKBENCH: "1", SHOWAI_HOST_DISPLAY: display },
      }));
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
        return result;
      };
      const project = (await call("project_create", { name: "Handoff" })).structuredContent as {
        data: { id: string };
      };
      const projectId = project.data.id;
      const title = 'Saved Page <&>';
      const blocks = display === "t3-html"
        ? [{ kind: "chart", data: { labels: ["A", "B"], series: [{ name: "Count", values: [1, 2] }] } }]
        : [];
      const cardPage = (await call("page_create", { projectId, title, blocks }))
        .structuredContent as { data: { document: { id: string } } };
      const target = { projectId, pageId: cardPage.data.document.id };
      if (display === "t3-html") {
        const body = (await call("page_present", target)).structuredContent as { data: { conversation: { path: string } } };
        const html = await readFile(body.data.conversation.path, "utf8");
        expect(html).toMatch(/^<!doctype html>/i);
        expect(html).toContain("data-showai-inline-root");
        expect(html).not.toContain('data-showai-packed-data="gzip"');
      }
      const { tools } = await client.listTools();
      const cardTool = tools.find(tool => tool.name === "card_present")!;
      const sessionFile = join(home, "local", "linked-workbench", "session.json");
      if (display === "mcp-app") {
        const native = await call("card_present", { ...target, openIn: "desktop" });
        expect(native._meta?.showaiCardDestination).toBe("desktop");
        expect(native._meta?.showaiPageCard).toMatchObject(target);
        expect(native._meta?.showaiPageCard).not.toHaveProperty("editorUrl");
        await expect(readFile(sessionFile)).rejects.toMatchObject({ code: "ENOENT" });
      }
      const shown = await call("card_present", target);
      expect(shown.structuredContent).toMatchObject({ data: { ...target, title } });
      if (display === "mcp-app") {
        const uri = (cardTool._meta?.ui as { resourceUri?: string })?.resourceUri;
        expect(uri).toBeDefined();
        const resource = (await client.readResource({ uri: uri! })).contents[0];
        expect(resource.mimeType).toBe("text/html;profile=mcp-app");
        if (!("text" in resource)) throw new Error("Expected the linked card HTML.");
        const browser = await chromium.launch({ executablePath: await readingBrowserExecutable() });
        try {
          const page = await browser.newPage();
          const list = await mountWorkbenchCards(page, resource.text, shown._meta!, {});
          expect(await list.getByRole("button", { name: "选择打开方式" }).count()).toBe(0);
          const main = list.locator(".showai-card-open");
          expect(await main.innerText()).toBe("显示原页编辑链接");
          await main.click();
          const link = await list.getByRole("textbox", { name: "网页编辑链接" }).inputValue();
          expect(new URL(link).searchParams.get("page")).toBe(target.pageId);
          expect(await list.getByRole("button", { name: "复制网页编辑链接" }).isVisible()).toBe(true);

          const second = (await call("page_create", { projectId, title: "Second page" }))
            .structuredContent as { data: { document: { id: string } } };
          const cli = join(process.cwd(), "dist-agent/cli.mjs");
          const args = [cli, "workbench", "url", "--surface", "t3-code", "--home", home, "--json"];
          const run = promisify(execFile);
          const whole = JSON.parse((await run(process.execPath, args)).stdout).data;
          const first = JSON.parse((await run(process.execPath, [...args, "--project", projectId, "--page", target.pageId])).stdout).data;
          expect(first.title).toBe(title);
          expect(whole.previewTarget.port).toBe(first.previewTarget.port);
          await expect(run(process.execPath, [...args, "--project", projectId, "--page", target.pageId, "--block", "missing"])).rejects.toThrow();
          await expect(run(process.execPath, [...args, "--block", "missing"])).rejects.toThrow();
          const workbench = await browser.newPage();
          await workbench.addInitScript(() => localStorage.setItem("showai:sidebar-locked", "true"));
          await workbench.goto(whole.url);
          await workbench.locator('[data-library-id="' + projectId + '"] .studio-tree-main').click();
          const openFromList = async (id: string) => {
            const [tab] = await Promise.all([
              workbench.waitForEvent("popup"),
              workbench.locator('.studio-sidebar [data-open-page="' + id + '"]').click(),
            ]);
            await tab.locator(".studio-page-title-input").waitFor();
            expect(new URL(tab.url()).searchParams.get("page")).toBe(id);
            expect(await tab.locator(".studio-window-topbar [role=tablist]").count()).toBe(0);
            return tab;
          };
          const firstTab = await openFromList(target.pageId);
          const secondTab = await openFromList(second.data.document.id);
          expect(await firstTab.locator(".studio-page-title-input").inputValue()).toBe(title);
          expect(await secondTab.locator(".studio-page-title-input").inputValue()).toBe("Second page");
          const [backToLibrary] = await Promise.all([
            firstTab.waitForEvent("popup"),
            firstTab.getByRole("button", { name: /ShowAI.*工作台|ShowAI Workbench/ }).click(),
          ]);
          await backToLibrary.waitForURL(whole.url);
          await firstTab.locator(".studio-page-title-input").fill("Saved before closing");
          expect(await firstTab.evaluate(() => window.showai!.prepareClose!())).toBe(true);
          await firstTab.close();
          const saved = await call("page_read", target);
          expect(saved.structuredContent).toMatchObject({ data: { document: { title: "Saved before closing" } } });
        } finally {
          await browser.close();
        }
      } else {
        expect(cardTool._meta?.ui).toBeUndefined();
        const output = shown.structuredContent as { data: { delivery: { html: string; path: string } } };
        const html = await readFile(display === "t3-html" ? output.data.delivery.path : output.data.delivery.html, "utf8");
        expect(html).toContain("Saved Page &lt;&amp;&gt;");
        expect(html).toContain(`showai://project/${target.projectId}/page/${target.pageId}`);
        if (display !== "t3-html") {
          expect(html).toMatch(/<div class="showai-card-actions"><a class="showai-card-open"[^>]+>[^<]+<\/a><\/div>/);
          expect(html).not.toContain('aria-haspopup="menu"');
        }
        if (display === "t3-html") {
          expect(html).toContain("<input readonly");
          expect(html).not.toContain("localhost:");
          await expect(readFile(sessionFile)).rejects.toMatchObject({ code: "ENOENT" });
          expect(tools.find(tool => tool.name === "workbench_open_destination")?._meta?.ui)
            .toEqual({ visibility: ["model"] });
          const missing = await client.callTool({ name: "workbench_open_destination", arguments: { ...target, destination: "desktop", blockId: "missing" } });
          expect(missing.isError).toBe(true);
        }
      }
      const missing = await client.callTool({
        name: "workbench_page_url",
        arguments: { ...target, pageId: "missing" },
      });
      expect(missing.isError).toBe(true);
      const opened = await call("workbench_page_url", target);
      const { data: { url } } = opened.structuredContent as { data: { url: string } };
      expect(new URL(url).hostname).toBe("127.0.0.1");
      expect(new URL(url).searchParams.get("page")).toBe(target.pageId);
      if (display === "mcp-app") expect(shown._meta?.showaiPageCard).toMatchObject({ editorUrl: url });
      const t3 = (await call("workbench_page_url", { ...target, surface: "t3-code" })).structuredContent as {
        data: { previewTarget: { kind: string; port: number; path: string } };
      };
      const { previewTarget } = t3.data;
      expect(previewTarget.kind).toBe("environment-port");
      const t3Url = new URL(previewTarget.path, `http://localhost:${previewTarget.port}`);
      const t3Page = await fetch(t3Url, { headers: { Origin: t3Url.origin } });
      expect(t3Page.status).toBe(200);
      expect(await t3Page.text()).toContain('"t3Page":true');
      const mismatchedOrigin = await fetch(t3Url, { headers: { Origin: new URL(url).origin } });
      expect(mismatchedOrigin.status).toBe(403);
      await mismatchedOrigin.body?.cancel();
      await client.close();
      const page = await fetch(url);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("__SHOWAI_LOCAL__");
      const crossOrigin = await fetch(url, { headers: { Origin: "https://example.com" } });
      expect(crossOrigin.status).toBe(403);
      await crossOrigin.body?.cancel();
    } finally {
      await client.close();
      const session = await readFile(join(home, "local/linked-workbench/session.json"), "utf8").then(
        text => JSON.parse(text) as { pid: number; url: string },
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
      if (session) {
        process.kill(session.pid, "SIGTERM");
        await expect.poll(() => fetch(new URL("/_showai/workbench", session.url), { method: "HEAD" })
          .then(result => result.ok, () => false), { timeout: 10_000 }).toBe(false);
      }
      await rm(home, { recursive: true, force: true });
    }
  },
  60_000,
);

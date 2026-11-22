import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, test } from "vitest";

test.each(["mcp-app", "model-html", "fragment-file"])(
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
      const cardPage = (await call("page_create", { projectId, title, blocks: [] }))
        .structuredContent as { data: { document: { id: string } } };
      const target = { projectId, pageId: cardPage.data.document.id };
      const { tools } = await client.listTools();
      const cardTool = tools.find(tool => tool.name === "card_present")!;
      const shown = await call("card_present", target);
      expect(shown.structuredContent).toMatchObject({ data: { ...target, title } });
      if (display === "mcp-app") {
        const uri = (cardTool._meta?.ui as { resourceUri?: string })?.resourceUri;
        expect(uri).toBeDefined();
        expect((await client.readResource({ uri: uri! })).contents[0].mimeType)
          .toBe("text/html;profile=mcp-app");
      } else {
        expect(cardTool._meta?.ui).toBeUndefined();
        const output = shown.structuredContent as { data: { delivery: { html: string } } };
        const html = await readFile(output.data.delivery.html, "utf8");
        expect(html).toContain("Saved Page &lt;&amp;&gt;");
        expect(html).toContain(`showai://project/${target.projectId}/page/${target.pageId}`);
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
  30_000,
);

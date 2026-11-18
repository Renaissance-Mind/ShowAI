import { randomBytes } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mcpFailure } from "./presentation-tools";
import {
  codexWorkbenchHtml,
  codexWorkbenchUri,
  codexWorkbenchThreadUri,
  type CodexWorkbenchMode,
} from "./codex-workbench-ui";

export type OpenCodexWorkbench = (key: string) => Promise<{
  url: string;
  localUrl: string;
  close(): Promise<void>;
}>;

const legacyWorkbenchUri = "ui://showai/workbench.html";
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export function registerCodexWorkbench(server: McpServer, open: OpenCodexWorkbench) {
  const key = randomBytes(32).toString("hex");
  let runtime: ReturnType<OpenCodexWorkbench> | undefined;
  const workbench = () => (runtime ??= open(key).catch((error) => {
    runtime = undefined;
    throw error;
  }));

  const onClose = server.server.onclose;
  server.server.onclose = () => {
    onClose?.();
    void runtime?.then((instance) => instance.close(), () => undefined)
      .catch((error) => console.error("ShowAI workbench shutdown:", error));
  };

  const views = [
    { mode: "global", name: "workbench_open_global", uri: codexWorkbenchUri, title: "ShowAI Workbench" },
    { mode: "thread", name: "workbench_open_page", uri: codexWorkbenchThreadUri, title: "ShowAI" },
  ] as const;
  const resources = [
    ...views,
    { mode: undefined, name: "workbench_legacy", uri: legacyWorkbenchUri },
  ];
  const mimeType = "text/html;profile=mcp-app";
  for (const { mode, name, uri } of resources) {
    server.registerResource(name, uri, { mimeType }, async () => {
      const { localUrl } = await workbench();
      return {
        contents: [{
          uri,
          mimeType,
          text: codexWorkbenchHtml(localUrl, mode),
          _meta: {
            ui: {
              csp: {
                connectDomains: [localUrl],
                resourceDomains: [localUrl, "blob:", "data:"],
                frameDomains: ["blob:", "data:"],
              },
              prefersBorder: false,
              permissions: { clipboardWrite: {} },
            },
          },
        }],
      };
    });
  }

  async function launch(mode: CodexWorkbenchMode) {
    try {
      const { url } = await workbench();
      const target = new URL(url);
      target.searchParams.set("codexWorkbench", key);
      target.searchParams.set("codexMode", mode);
      return {
        content: [{ type: "text" as const, text: "ShowAI workbench" }],
        _meta: { showaiWorkbench: { url: target.href } },
      };
    } catch (error) {
      return mcpFailure(error);
    }
  }

  for (const { mode, name, uri, title } of views) {
    server.registerTool(name, {
      title,
      description: mode === "global"
        ? "Open the ShowAI project workbench."
        : "Open the ShowAI editor next to this chat.",
      inputSchema: {},
      annotations: readOnly,
      _meta: {
        ui: { resourceUri: uri, visibility: ["app"] },
        "openai/ui": { entrypoints: [{ type: mode }] },
      },
    }, () => launch(mode));
  }

  server.registerTool("workbench_open", {
    title: "ShowAI",
    description: "Open the ShowAI workbench from a previous conversation.",
    inputSchema: {},
    annotations: readOnly,
    _meta: { ui: { resourceUri: legacyWorkbenchUri, visibility: ["app"] } },
  }, () => launch("global"));

  server.registerTool("workbench_refresh", {
    description: "Return a fresh launch target for the open ShowAI workbench.",
    inputSchema: { mode: z.enum(["global", "thread"]) },
    annotations: readOnly,
    _meta: { ui: { visibility: ["app"] } },
  }, ({ mode }) => launch(mode));
}

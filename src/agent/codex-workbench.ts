import { randomBytes } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpFailure } from "./presentation-tools";
import { codexWorkbenchHtml, codexWorkbenchUri } from "./codex-workbench-ui";

export type OpenCodexWorkbench = (key: string) => Promise<{
  url: string;
  localUrl: string;
  close(): Promise<void>;
}>;

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

  const mimeType = "text/html;profile=mcp-app";
  server.registerResource(
    "showai-workbench",
    codexWorkbenchUri,
    { mimeType },
    async () => {
      const { localUrl } = await workbench();
      return {
        contents: [{
          uri: codexWorkbenchUri,
          mimeType,
          text: codexWorkbenchHtml,
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
    },
  );

  for (const [type, name, description] of [
    ["global", "workbench_open", "Open the ShowAI project workbench."],
    ["thread", "workbench_open_page", "Open the ShowAI editor next to this chat."],
  ] as const) {
    server.registerTool(name, {
      title: "ShowAI",
      description,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: codexWorkbenchUri, visibility: ["app"] },
        "openai/ui": { entrypoints: [{ type }] },
      },
    }, async () => {
      try {
        const { url } = await workbench();
        const target = new URL(url);
        target.searchParams.set("codexWorkbench", key);
        target.searchParams.set("codexMode", type);
        return {
          content: [{ type: "text" as const, text: "ShowAI workbench" }],
          _meta: { showaiWorkbench: { url: target.href } },
        };
      } catch (error) {
        return mcpFailure(error);
      }
    });
  }
}

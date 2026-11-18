import { randomBytes } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import lightLogo from "../../plugins/showai/assets/logo.svg?raw";
import darkLogo from "../../plugins/showai/assets/logo-dark.svg?raw";
import { workbenchRoutes, type CodexWorkbenchTransport } from "../host/codex-workbench-transport";
import { mcpFailure, mcpSuccess } from "./presentation-tools";
import type { AgentService } from "./service";
import {
  codexPageIdentity,
  codexPageReferenceExtension,
  codexPageReferenceMaxLength,
  resolveCodexPageReference,
  writeCodexPageReference,
} from "./codex-page-reference";
import {
  codexWorkbenchHtml,
  codexWorkbenchUri,
  codexWorkbenchFileUri,
  codexWorkbenchCardUri,
  codexWorkbenchThreadUri,
  type CodexWorkbenchMode,
} from "./codex-workbench-ui";

export type OpenCodexWorkbench = (key: string) => Promise<{
  url: string;
  localUrl: string;
  transport: CodexWorkbenchTransport;
  close(): Promise<void>;
}>;

const legacyWorkbenchUri = "ui://showai/workbench.html";
export const codexWorkbenchIcons = ([
  ["light", lightLogo],
  ["dark", darkLogo],
] as const).map(([theme, svg]) => ({
  src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  mimeType: "image/svg+xml",
  sizes: ["any"],
  theme,
}));
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const appOnly = { ui: { visibility: ["app"] } };
const clientId = z.string().regex(/^[\w-]{1,100}$/);

export function registerCodexWorkbench(
  server: McpServer,
  open: OpenCodexWorkbench,
  service: AgentService,
  presentationDirectory?: string,
) {
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
    { mode: "thread", name: "workbench_file", uri: codexWorkbenchFileUri, entrypoint: "file" },
    { mode: "thread", name: "workbench_page_card", uri: codexWorkbenchCardUri, entrypoint: "card" },
    { mode: undefined, name: "workbench_legacy", uri: legacyWorkbenchUri },
    { mode: "global", name: "workbench_global_v2", uri: "ui://showai/workbench-v2.html" },
    { mode: "thread", name: "workbench_thread_v2", uri: "ui://showai/workbench-thread-v2.html" },
  ] as const;
  const mimeType = "text/html;profile=mcp-app";
  for (const resource of resources) {
    const { mode, name, uri } = resource;
    const entrypoint = "entrypoint" in resource ? resource.entrypoint : undefined;
    server.registerResource(name, uri, { mimeType }, async () => {
      return {
        contents: [{
          uri,
          mimeType,
          text: codexWorkbenchHtml(mode, entrypoint, codexWorkbenchIcons[0].src),
          _meta: {
            ui: {
              csp: {
                resourceDomains: ["blob:", "data:"],
                frameDomains: ["blob:", "data:"],
              },
              prefersBorder: false,
              permissions: { clipboardWrite: {} },
            },
            ...(entrypoint === "card" ? {
              "openai/ui": { availableDisplayModes: ["inline", "fullscreen"] },
            } : {}),
          },
        }],
      };
    });
  }

  async function launch(mode: CodexWorkbenchMode) {
    try {
      const { url, transport } = await workbench();
      const target = new URL(url);
      target.searchParams.set("codexWorkbench", key);
      target.searchParams.set("codexMode", mode);
      return {
        content: [{ type: "text" as const, text: "ShowAI workbench" }],
        _meta: { showaiWorkbench: { url: target.href, bundle: await transport.bundle() } },
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

  server.registerTool("workbench_open_file", {
    title: "ShowAI",
    description: "Open the original Page linked by a ShowAI reference file.",
    inputSchema: {
      file: z.object({ name: z.string().min(1), resourceUri: z.string().min(1) }),
    },
    annotations: readOnly,
    _meta: {
      ui: { resourceUri: codexWorkbenchFileUri, visibility: ["app"] },
      "openai/ui": {
        entrypoints: [{ type: "file", extensions: [codexPageReferenceExtension] }],
      },
    },
  }, () => launch("thread"));

  server.registerTool("workbench_page_reference", {
    title: "Create a ShowAI page reference",
    description: "Create a local reference file that opens the saved ShowAI Page when clicked in Codex. Link the returned absolute path in the reply.",
    inputSchema: codexPageIdentity,
    annotations: readOnly,
    _meta: {
      ui: { resourceUri: codexWorkbenchCardUri, visibility: ["model", "app"] },
    },
  }, async ({ projectId, pageId }) => {
    try {
      const { file, ...reference } = await writeCodexPageReference(
        service, presentationDirectory, projectId, pageId,
      );
      const result = mcpSuccess(reference);
      return {
        ...result,
        content: [...result.content, file],
        _meta: { showaiPageCard: { projectId, pageId, title: reference.title } },
      };
    } catch (error) {
      return mcpFailure(error);
    }
  });

  server.registerTool("workbench_resolve_reference", {
    description: "Verify a ShowAI reference file read through the Codex host and locate its saved Page.",
    inputSchema: { source: z.string().min(1).max(codexPageReferenceMaxLength) },
    annotations: readOnly,
    _meta: appOnly,
  }, async ({ source }) => {
    try {
      const page = await resolveCodexPageReference(service, source);
      return { content: [], _meta: { showaiWorkbenchData: page } };
    } catch (error) {
      return mcpFailure(error);
    }
  });

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

  async function proxy<T>(run: (transport: CodexWorkbenchTransport) => T | Promise<T>) {
    try {
      const value = await run((await workbench()).transport);
      return { content: [], _meta: { showaiWorkbenchData: value } };
    } catch (error) {
      return mcpFailure(error);
    }
  }
  server.registerTool("workbench_asset", {
    description: "Read a packaged workbench asset chunk.",
    inputSchema: { name: z.string().min(1), offset: z.number().int().nonnegative() },
    annotations: readOnly,
    _meta: appOnly,
  }, ({ name, offset }) => proxy((transport) => transport.asset(name, offset)));
  server.registerTool("workbench_request", {
    description: "Apply a workbench operation from the open editor.",
    inputSchema: {
      route: z.enum(workbenchRoutes),
      args: z.record(z.string(), z.unknown()),
      client: clientId,
    },
    _meta: appOnly,
  }, ({ route, args, client }) => proxy((transport) => transport.request(route, args, client)));
  server.registerTool("workbench_changes", {
    description: "Read workbench changes after a cursor.",
    inputSchema: { after: z.number().int().min(-1), client: clientId },
    annotations: readOnly,
    _meta: appOnly,
  }, ({ after, client }) => proxy((transport) => transport.changes(after, client)));
  server.registerTool("workbench_media", {
    description: "Read local media from a workbench grant.",
    inputSchema: {
      grant: z.string().regex(/^[0-9a-f-]{36}$/),
      offset: z.number().int().nonnegative(),
    },
    annotations: readOnly,
    _meta: appOnly,
  }, ({ grant, offset }) => proxy((transport) => transport.media(grant, offset)));
}

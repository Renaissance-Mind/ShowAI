import {
  CAPACITY,
  CapacityError,
  readCapacityText,
  formatBytes,
} from "../portable/capacity.mjs";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  type RegisteredTool,
  type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { getObjectShape } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import { createMcpServer } from "./mcp";
import {
  McpAuthorization,
  AuthorizationError,
  type ProjectGrant,
} from "./mcp-auth";
import { RemoteWorkspaces, type RemoteWorkspaceContext } from "./mcp-workspace";
import {
  organizationWriteTools,
  sidebarTools,
  draftTools,
} from "./mcp-organization";
import {
  mcpSuccess,
  mcpFailure,
  type Presentation,
} from "./presentation-tools";
import { inlinePresentation } from "./presentation";
import { serverBaseUrl } from "../sync/server-url";
import { FileStore } from "../core/store";
import type { CloudBrowserCheck } from "./cloud-browser-check";
import { getMcpGuide } from "./mcp-guides";
import {
  mcpSkillGuide,
  mcpSkillNames,
  remoteSkillInstructions,
} from "./mcp-skill-guides";

const writeTools = new Set([
  ...organizationWriteTools,
  "project_create",
  "page_create",
  "page_save",
  "page_apply",
  "component_save",
  "template_apply",
  "template_save",
  "catalog_fork",
  "catalog_merge_resolve",
  "page_merge_save",
  "workspace_resolve",
]);
const localOnly = new Set([
  "component_import",
  "publication_prepare",
  "workspace_recover_package",
  "workspace_conflict",
  "workspace_resolve",
]);
const publicTools = new Set([
  "guide",
  "showai_capabilities",
  "public_catalog_list",
  "public_catalog_describe",
  "render_document",
  "presentation_source",
]);
const oauth = (write: boolean) => [
  {
    type: "oauth2",
    scopes: write ? ["projects.read", "projects.write"] : ["projects.read"],
  },
];
type StoredArtifact = {
  html: string;
  inline?: string;
  online?: string;
  compact?: string;
  source: string;
  expires: number;
  publicSource: boolean;
};
const json = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
  });

export interface McpHttpOptions {
  stateDirectory: string;
  publicUrl: string;
  syncServers?: string[];
  widgetDomain?: string;
  allowedHosts?: string[];
  /** Successful startup screenshot check, supplied by the Cloud entry point. */
  browserRendering?: CloudBrowserCheck;
  /** Cloud deployments persist private state before acknowledging a request. */
  durableState?: {
    restore(): Promise<void>;
    run(
      operation: () => Promise<Response>,
      checkpoint: () => void,
    ): Promise<Response>;
  };
}
export async function createMcpHttpApp(options: McpHttpOptions) {
  const url = new URL(options.publicUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error(
      "MCP public URL must be an HTTPS origin, or loopback HTTP for local development.",
    );
  const origin = url.origin,
    state = resolve(options.stateDirectory);
  const servers = (options.syncServers ?? []).map(serverBaseUrl);
  await mkdir(state, { recursive: true, mode: 0o700 });
  const authorization = await McpAuthorization.open(
    join(state, "auth"),
    origin,
    servers,
  );
  const workspaces = new RemoteWorkspaces(join(state, "replicas"));
  const artifacts = new Map<string, StoredArtifact>();
  const artifactDirectory = join(state, "artifacts");
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(artifactDirectory)) {
    if (!/^[A-Za-z0-9_-]{43}\.json$/.test(entry)) continue;
    const value = JSON.parse(
      await readFile(join(artifactDirectory, entry), "utf8"),
    ) as StoredArtifact;
    if (value.expires > Date.now()) artifacts.set(entry.slice(0, -5), value);
    else await rm(join(artifactDirectory, entry));
  }
  let renderCount = 0;
  const storePresentation = async (
    value: Presentation,
    publicSource = false,
  ) => {
    for (const [key, item] of artifacts)
      if (item.expires <= Date.now()) {
        artifacts.delete(key);
        await rm(join(artifactDirectory, key + ".json"), { force: true });
      }
    if (artifacts.size >= 100)
      throw new Error(
        "Presentation capacity reached. Retry after older previews expire.",
      );
    const key = randomBytes(32).toString("base64url"),
      expires = Date.now() + 3600_000;
    artifacts.set(key, {
      html: value.html,
      inline: value.inline,
      online: value.online,
      compact: value.compact,
      source: value.source,
      expires,
      publicSource,
    });
    await writeFile(
      join(artifactDirectory, key + ".json"),
      JSON.stringify(artifacts.get(key)),
      { mode: 0o600 },
    );
    return {
      artifactId: key,
      html: `${origin}/artifacts/${key}/page.html`,
      ...(value.inline
        ? { inline: `${origin}/artifacts/${key}/inline.html` }
        : {}),
      ...(value.online
        ? { online: `${origin}/artifacts/${key}/online.html` }
        : {}),
      ...(value.compact
        ? { compact: `${origin}/artifacts/${key}/compact.html` }
        : {}),
      source: `${origin}/artifacts/${key}/page.showai.json`,
      expiresAt: new Date(expires).toISOString(),
    };
  };
  async function execute(
    request: Request,
    body: Record<string, unknown>,
    context?: RemoteWorkspaceContext,
    grant?: ProjectGrant,
  ) {
    const remoteTools = new Set([
      ...publicTools,
      "projects_list",
      "project_create",
    ]);
    const server = createMcpServer({
      root: context?.root ?? join(state, "public"),
      projectId: context?.projectId ?? "unselected",
      projectAccess: "library",
      workspaceProjectIds: context?.projectIds ?? [],
      storeProjectPresentation: (value) => storePresentation(value, false),
      sourceContext: {
        actor: { kind: "external", label: "MCP client" },
        channel: "mcp",
      },
      instructions: remoteSkillInstructions,
      presentation: {
        transport: "http",
        storePresentation: (value) => storePresentation(value, true),
        widgetDomain: options.widgetDomain,
        privateProjects: servers.length > 0,
      },
      decorateTool(name: string, tool: RegisteredTool) {
        if (localOnly.has(name)) {
          tool.remove();
          return;
        }
        remoteTools.add(name);
        if (name === "guide") {
          const shape = getObjectShape(tool.inputSchema);
          if (!shape) throw new Error("Missing guide input schema.");
          const original = tool.handler as ToolCallback<z.ZodRawShape>;
          tool.update({
            description:
              "Start every ShowAI task with guide() to read the shared Skill entrypoint and task routes. Then use skill to read one workflow, or skill/file to read an exact referenced file. No installed plugin or local files are needed. topic still reads runtime operation guides; stage applies to topic presentation. knownHash is only for exact content already held this turn.",
            paramsSchema: {
              ...shape,
              skill: z.enum(mcpSkillNames).optional(),
              file: z.string().min(1).max(500).optional(),
              section: z.string().min(1).max(500).optional(),
            },
            _meta: { securitySchemes: [{ type: "noauth" }] },
            callback: async (args, extra) => {
              if ("topic" in args && args.topic) {
                if (args.skill || args.file || args.section)
                  return mcpFailure(
                    new Error("Choose either topic or skill/file, not both."),
                  );
                return original(args, extra);
              }
              if ("stage" in args && args.stage)
                return mcpFailure(
                  new Error("stage requires topic presentation."),
                );
              if ((args.file || args.section) && !args.skill)
                return mcpFailure(new Error("file and section require skill."));
              try {
                return mcpSuccess({
                  ...mcpSkillGuide(args),
                  connection: {
                    mcpUrl: `${origin}/mcp`,
                    tools: [...remoteTools].sort(),
                    discovery:
                      "These tools are exposed by this exact MCP server. The host may load only a subset initially. Use its tool discovery for the selected connection to load a listed tool before declaring it missing. Never substitute a similarly named connection. A listed tool does not imply the account has its required OAuth scope or project permission.",
                  },
                  ...(!args.skill ? { operationGuides: getMcpGuide() } : {}),
                });
              } catch (error) {
                return mcpFailure(error);
              }
            },
          });
          return;
        }
        const shape = getObjectShape(tool.inputSchema);
        if (!shape) throw new Error(`Missing tool input schema: ${name}`);
        const original = tool.handler as ToolCallback<z.ZodRawShape>;
        const paramsSchema: Record<string, z.ZodRawShape[string]> = {
          ...shape,
          projectId: z
            .string()
            .min(1)
            .describe(
              "Authorized shared project ID returned by projects_list.",
            ),
        };
        if ("out" in paramsSchema) delete paramsSchema.out;
        if (name === "page_export")
          paramsSchema.format = z.enum(["html", "inline"]);
        if (name === "page_create" || name === "page_save") {
          delete paramsSchema.components;
          delete paramsSchema.remoteComponents;
        }
        tool.update({
          ...(name === "page_export"
            ? {
                description:
                  "Export one page or selected blocks as downloadable HTML or inline HTML. format is html or inline; remote whole-site export is unavailable. Component references must already resolve in this project.",
              }
            : {}),
          ...(name === "page_create"
            ? {
                description:
                  "Create a page/board in this authorized project, optionally in parentId. Save custom component source with component_save first, then use exact page references. Compiled components and external publication imports are unavailable on this connection.",
              }
            : {}),
          ...(name === "page_save"
            ? {
                description:
                  "Save a page with its read baseHash/baseRevision. Custom components must already be saved in this project; compiled component and external publication imports are unavailable.",
              }
            : {}),
          paramsSchema,
          _meta: {
            ...tool._meta,
            securitySchemes: oauth(writeTools.has(name)),
          },
          callback: async (input, extra) => {
            const { projectId: _projectId, ...rest } = input;
            const args: Record<string, unknown> = rest;
            for (const key of ["destinationProjectId", "relativeProjectId"]) {
              if (typeof args[key] === "string") {
                const local = context?.projectMap[args[key] as string];
                if (!local)
                  return mcpFailure(
                    new Error(
                      "The participating project is not authorized in this operation.",
                    ),
                  );
                args[key] = local;
              }
            }
            if (
              args.remoteComponents &&
              Array.isArray(args.remoteComponents) &&
              args.remoteComponents.length
            )
              return mcpFailure(
                new Error(
                  "Remote MCP accepts bundled component source or runtimes. Import external publication dependencies with the local runtime first.",
                ),
              );
            if (
              args.components &&
              Array.isArray(args.components) &&
              args.components.length
            )
              return mcpFailure(
                new Error(
                  "Use component_save with editable source and page references. Remote calls cannot install opaque compiled packages.",
                ),
              );
            let outputDirectory: string | undefined;
            try {
              if (
                name === "page_export" ||
                (name === "page_read" &&
                  args.view &&
                  args.view !== "structured")
              ) {
                if (args.format === "site")
                  return mcpFailure(
                    new Error(
                      "This remote MCP connection supports page exports only. Whole-site export requires a host connection advertising that capability; do not silently switch connections.",
                    ),
                  );
                outputDirectory = join(state, "exports", randomUUID());
                await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
                args.out = join(
                  outputDirectory,
                  args.view === "image" ? "page.png" : "page.html",
                );
              }
              const result = await original(args, extra);
              if (
                result.structuredContent &&
                typeof result.structuredContent.data === "object" &&
                result.structuredContent.data !== null &&
                !Array.isArray(result.structuredContent.data)
              ) {
                const data = {
                  ...(result.structuredContent.data as Record<string, unknown>),
                };
                const reverse = Object.fromEntries(
                  Object.entries(context?.projectMap ?? {}).map(
                    ([remote, local]) => [local, remote],
                  ),
                );
                const sanitize = (value: unknown, key = ""): unknown => {
                  if (typeof value === "string") {
                    if (
                      [
                        "projectId",
                        "sourceProjectId",
                        "destinationProjectId",
                        "projectOrder",
                      ].includes(key)
                    )
                      return reverse[value] ?? value;
                    for (const [local, remote] of Object.entries(reverse))
                      if (value.startsWith(`projects/${local}/`))
                        return `projects/${remote}/${value.slice(`projects/${local}/`.length)}`;
                    return value;
                  }
                  // Page bodies, draft payloads and editable package source are
                  // authored JSON. Metadata cleanup must never alter their keys.
                  if (
                    [
                      "document",
                      "content",
                      "baseContent",
                      "source",
                      "schema",
                      "manifest",
                      "files",
                      "assets",
                      "documentation",
                      "examples",
                    ].includes(key)
                  )
                    return value;
                  if (Array.isArray(value))
                    return value.map((item) => sanitize(item, key));
                  if (!value || typeof value !== "object") return value;
                  if (
                    "format" in value &&
                    value.format === "showai-project" &&
                    "id" in value &&
                    typeof value.id === "string"
                  )
                    value = { ...value, id: reverse[value.id] ?? value.id };
                  return Object.fromEntries(
                    Object.entries(value as Record<string, unknown>)
                      .filter(
                        ([name, item]) =>
                          ![
                            "root",
                            "home",
                            "sourceDirectory",
                            "binding",
                            "bindings",
                            "sourcePaths",
                            "metadataPath",
                          ].includes(name) &&
                          !(
                            name === "path" &&
                            typeof item === "string" &&
                            item.startsWith("/")
                          ),
                      )
                      .map(([name, item]) => [
                        ["projectGroups", "entryOrder"].includes(key)
                          ? (reverse[name] ?? name)
                          : name,
                        sanitize(item, name),
                      ]),
                  );
                };
                if (name === "board_read" && Array.isArray(data.images))
                  data.images = data.images.map((value) => {
                    const image = { ...(value as Record<string, unknown>) };
                    delete image.path;
                    return image;
                  });
                if (
                  outputDirectory &&
                  typeof data.path === "string" &&
                  (name === "page_export" || args.view === "html")
                ) {
                  const output = await readFile(data.path, "utf8");
                  const sourcePath =
                    data.sourcePaths && Array.isArray(data.sourcePaths)
                      ? data.sourcePaths[0]
                      : undefined;
                  const preview =
                    args.format === "inline"
                      ? { inline: output }
                      : await inlinePresentation(output);
                  const delivery = await storePresentation({
                    title: String(data.title ?? "ShowAI"),
                    document: {} as Presentation["document"],
                    html:
                      args.format === "inline"
                        ? `<!doctype html><meta charset="utf-8">${output}`
                        : output,
                    ...preview,
                    source:
                      typeof sourcePath === "string"
                        ? await readFile(sourcePath, "utf8")
                        : "{}",
                    persistence: { savedToProject: false, synchronized: false },
                    bytes: {
                      html: Buffer.byteLength(output),
                      inline: preview.inline
                        ? Buffer.byteLength(preview.inline)
                        : null,
                      online: null,
                      compact: null,
                    },
                  });
                  data.delivery = delivery;
                  if (preview.inlineError)
                    data.inlineError = preview.inlineError;
                }
                for (const key of [
                  "path",
                  "root",
                  "home",
                  "sourceDirectory",
                  "sourcePaths",
                  "metadataPath",
                  "url",
                ])
                  delete data[key];
                result.structuredContent = {
                  ...result.structuredContent,
                  data: sanitize(data),
                };
                let rewritten = false;
                result.content = result.content.map((item) =>
                  item.type === "text" && (name !== "board_read" || !rewritten)
                    ? {
                        type: "text" as const,
                        text:
                          ((rewritten = true),
                          JSON.stringify(result.structuredContent)),
                      }
                    : item,
                );
              }
              if (
                name === "drafts_list" &&
                Array.isArray(result.structuredContent?.data)
              ) {
                const reverse = Object.fromEntries(
                  Object.entries(context?.projectMap ?? {}).map(
                    ([remote, local]) => [local, remote],
                  ),
                );
                const data = result.structuredContent.data.map(
                  (record: Record<string, unknown>) => ({
                    ...record,
                    projectId:
                      typeof record.projectId === "string"
                        ? (reverse[record.projectId] ?? record.projectId)
                        : record.projectId,
                    path:
                      typeof record.path === "string" &&
                      typeof record.projectId === "string" &&
                      reverse[record.projectId] &&
                      record.path.startsWith(`projects/${record.projectId}/`)
                        ? `projects/${reverse[record.projectId]}/${record.path.slice(`projects/${record.projectId}/`.length)}`
                        : record.path,
                  }),
                );
                result.structuredContent = {
                  ...result.structuredContent,
                  data,
                };
                result.content = [
                  {
                    type: "text",
                    text: JSON.stringify(result.structuredContent),
                  },
                ];
              }
              return result;
            } finally {
              if (outputDirectory)
                await rm(outputDirectory, { recursive: true, force: true });
            }
          },
        });
      },
    });
    server.registerTool(
      "presentation_source",
      {
        description:
          "Retrieve the editable input for a public render_document result through MCP when the execution environment cannot download its URL. Reassemble text chunks in offset order, then parse JSON. This does not expose private project exports. The result is usable as render_document input, including original custom source packages.",
        inputSchema: {
          artifactId: z.string(),
          offset: z.number().int().min(0).optional(),
          limit: z.number().int().min(1000).max(64000).optional(),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        _meta: { securitySchemes: [{ type: "noauth" }] },
      },
      async ({ artifactId, offset = 0, limit = 64000 }) => {
        const artifact = artifacts.get(artifactId);
        if (
          !artifact ||
          !artifact.publicSource ||
          artifact.expires <= Date.now()
        )
          return mcpFailure(
            new Error(
              "This public presentation is unavailable or expired. Render it again.",
            ),
          );
        const parsed = JSON.parse(artifact.source);
        const source = JSON.stringify(
          {
            document: parsed.document,
            ...(parsed.componentSources?.length
              ? { componentSources: parsed.componentSources }
              : {}),
          },
          null,
          2,
        );
        if (offset > source.length)
          return mcpFailure(new Error("Offset exceeds the source length."));
        const end = Math.min(offset + limit, source.length);
        return mcpSuccess({
          text: source.slice(offset, end),
          offset,
          nextOffset: end < source.length ? end : null,
          totalCharacters: source.length,
          complete: end === source.length,
        });
      },
    );
    server.registerTool(
      "projects_list",
      {
        description:
          "List projects explicitly authorized for this connection, with current permissions. Does not require HTML display. Pass the selected id as projectId to project tools.",
        inputSchema: { includeArchived: z.boolean().optional() },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        _meta: { securitySchemes: oauth(false) },
      },
      async ({ includeArchived }) =>
        grant
          ? mcpSuccess(await workspaces.projects(grant, includeArchived))
          : mcpFailure(new Error("Sign in to ShowAI.")),
    );
    server.registerTool(
      "project_create",
      {
        description:
          "Create a cloud project in the authorized account when the user asks. Requires account-wide authorization and projects.create. Returns the server project id to use for subsequent page operations.",
        inputSchema: {
          name: z.string().trim().min(1).max(1000),
          operationId: z
            .string()
            .uuid()
            .optional()
            .describe(
              "Reuse the same UUID only to retry the same project creation.",
            ),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
        _meta: {
          securitySchemes: [
            {
              type: "oauth2",
              scopes: ["projects.read", "projects.write", "projects.create"],
            },
          ],
        },
      },
      async ({ name, operationId }) => {
        try {
          return grant
            ? mcpSuccess(
                await workspaces.createProject(grant, name, operationId),
              )
            : mcpFailure(new Error("Sign in to ShowAI."));
        } catch (error) {
          return mcpFailure(error);
        }
      },
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: CAPACITY.authoringRequestBytes,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, {
        parsedBody: body,
      });
      if (response.status === 202) return response;
      const output = await response.json();
      // The SDK preserves tool extensions in _meta. Advertise the canonical field as well.
      if (output.result?.tools)
        for (const tool of output.result.tools)
          if (tool._meta?.securitySchemes)
            tool.securitySchemes = tool._meta.securitySchemes;
      return json(output, response.status);
    } finally {
      await server.close();
    }
  }
  return {
    authorization,
    async fetch(request: Request): Promise<Response> {
      const target = new URL(request.url);
      const allowedHosts = [url.host, ...(options.allowedHosts ?? [])];
      if (!allowedHosts.includes(target.host))
        return json({ error: "Invalid host." }, 421);
      const requestOrigin = request.headers.get("origin");
      const artifactRead =
        target.pathname.startsWith("/artifacts/") &&
        ["GET", "HEAD"].includes(request.method);
      if (requestOrigin && requestOrigin !== origin && !artifactRead)
        return json({ error: "Origin not allowed." }, 403);
      if (target.pathname === "/health")
        return json({
          ok: true,
          protocol: "showai-agent-http-v1",
          publicPresentation: true,
          privateProjects: servers.length > 0,
          ...(options.browserRendering
            ? { browserRendering: options.browserRendering }
            : {}),
        });
      const auth = await authorization.fetch(request);
      if (auth) return auth;
      const asset = target.pathname.match(
        /^\/artifacts\/([A-Za-z0-9_-]{43})\/(page\.html|inline\.html|online\.html|compact\.html|page\.showai\.json)$/,
      );
      if (asset && ["GET", "HEAD"].includes(request.method)) {
        const value = artifacts.get(asset[1]);
        if (!value || value.expires <= Date.now())
          return json(
            { error: "Preview expired. Render the page again." },
            404,
          );
        const content =
          asset[2] === "page.html"
            ? value.html
            : asset[2] === "inline.html"
              ? value.inline
              : asset[2] === "online.html"
                ? value.online
                : asset[2] === "compact.html"
                  ? value.compact
                  : value.source;
        if (!content)
          return json(
            {
              error:
                "Inline preview unavailable. Use the complete HTML or select fewer blocks.",
            },
            404,
          );
        return new Response(request.method === "HEAD" ? null : content, {
          headers: {
            "content-type": asset[2].endsWith(".json")
              ? "application/json"
              : "text/html; charset=utf-8",
            "content-disposition": `attachment; filename="${asset[2]}"`,
            "cache-control": "private, no-store",
            "access-control-allow-origin": "*",
            "referrer-policy": "no-referrer",
            "x-content-type-options": "nosniff",
            "content-security-policy": "sandbox allow-scripts allow-downloads",
          },
        });
      }
      if (target.pathname !== "/mcp") return json({ error: "Not found." }, 404);
      if (request.method !== "POST")
        return json({ error: "Use Streamable HTTP POST." }, 405, {
          allow: "POST",
        });
      let raw: string;
      try {
        raw = await readCapacityText(
          request,
          CAPACITY.authoringRequestBytes,
          "HTTP MCP authoring input",
        );
      } catch (error) {
        if (!(error instanceof CapacityError)) throw error;
        return json(
          {
            error: error.message,
            code: error.code,
            actualBytes: error.actualBytes,
            limitBytes: error.limitBytes,
          },
          413,
        );
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw);
      } catch {
        return json(
          {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Invalid JSON." },
          },
          400,
        );
      }
      if (!body || Array.isArray(body) || typeof body !== "object")
        return json({ error: "One JSON-RPC request is required." }, 400);
      const params = body.params as
        { name?: string; arguments?: Record<string, unknown> } | undefined;
      const name = body.method === "tools/call" ? params?.name : undefined;
      const toolError = (error: unknown) =>
        json({
          jsonrpc: "2.0",
          id: body.id ?? null,
          result: {
            ...mcpFailure(error),
            ...(error instanceof AuthorizationError &&
            ["invalid_token", "insufficient_scope"].includes(error.code)
              ? {
                  _meta: {
                    "mcp/www_authenticate": [
                      authorization.challenge(
                        name === "project_create"
                          ? "projects.read projects.write projects.create"
                          : writeTools.has(name ?? "")
                            ? "projects.read projects.write"
                            : "projects.read",
                      ),
                    ],
                  },
                }
              : {}),
          },
        });
      try {
        if (name && !publicTools.has(name)) {
          const bearer = request.headers
            .get("authorization")
            ?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
          const grant = authorization.verify(
            bearer,
            name === "project_create"
              ? "projects.create"
              : writeTools.has(name)
                ? "projects.write"
                : "projects.read",
          );
          if (name === "projects_list" || name === "project_create")
            return execute(request, body, undefined, grant);
          if (
            (name === "page_create" || name === "page_save") &&
            ["components", "remoteComponents"].some(
              (key) => params?.arguments?.[key] !== undefined,
            )
          )
            return toolError(
              new Error(
                "This connection accepts saved component references. Use component_save before page creation/saving; components and remoteComponents are not supported parameters.",
              ),
            );
          const project = params?.arguments?.projectId;
          if (typeof project !== "string" || !project)
            return toolError(new Error("Pass projectId from projects_list."));
          const participants = [project];
          for (const key of ["destinationProjectId", "relativeProjectId"])
            if (typeof params?.arguments?.[key] === "string")
              participants.push(params.arguments[key] as string);
          if (sidebarTools.has(name))
            participants.push(
              ...(await workspaces.projects(grant, true)).map((p) => p.id),
            );
          const { value, synchronization, synchronizations } =
            await workspaces.withProjects(
              grant,
              participants,
              writeTools.has(name),
              (context) => execute(request, body, context, grant),
              {
                administrator:
                  name === "project_update" &&
                  typeof params?.arguments?.archived === "boolean"
                    ? project
                    : undefined,
                synchronizeWrites:
                  !draftTools.has(name) &&
                  !["sidebar_group_create", "sidebar_group_update"].includes(
                    name,
                  ),
                writeProjectIds: writeTools.has(name)
                  ? [
                      project,
                      ...(name === "entry_move" &&
                      typeof params?.arguments?.destinationProjectId ===
                        "string"
                        ? [params.arguments.destinationProjectId]
                        : []),
                    ]
                  : [],
                afterSynchronization: async (response, context) => {
                  const result = await response.json();
                  const data = result.result?.structuredContent?.data;
                  if (result.result && !result.result.isError && data) {
                    const store = new FileStore(context.root);
                    const refresh = async (
                      record: {
                        document?: { id?: string };
                        hash?: string;
                        revision?: string;
                      },
                      remoteId: string,
                    ) => {
                      if (!record?.document?.id || !record.hash) return;
                      const current = await store.readPage(
                        context.projectMap[remoteId],
                        record.document.id,
                      );
                      if (record.hash === current.hash)
                        record.revision = current.revision;
                    };
                    if (data.document) await refresh(data, project);
                    if (data.page)
                      await refresh(
                        data.page,
                        typeof params?.arguments?.destinationProjectId ===
                          "string"
                          ? params.arguments.destinationProjectId
                          : project,
                      );
                  }
                  return json(result, response.status);
                },
              },
            );
          const result = await value.json();
          if (result.result && !result.result.isError) {
            result.result.structuredContent = {
              ...(result.result.structuredContent ?? {}),
              synchronization,
              ...(synchronizations.length > 1 ? { synchronizations } : {}),
              ...(draftTools.has(name) || sidebarTools.has(name)
                ? {
                    workspace: {
                      scope: "connection",
                      draftsSynchronized: false,
                      sidebarOrganizationSynchronized: false,
                    },
                  }
                : {}),
            };
            const data = result.result.structuredContent.data;
            if (data && typeof data === "object" && data.persistence) {
              data.synchronization = synchronization;
              data.persistence.synchronized =
                synchronization.state === "synced";
            }
            let rewritten = false;
            result.result.content = (result.result.content ?? []).map(
              (item: { type: string; text?: string }) =>
                item.type === "text" && (name !== "board_read" || !rewritten)
                  ? {
                      type: "text",
                      text:
                        ((rewritten = true),
                        JSON.stringify(result.result.structuredContent)),
                    }
                  : item,
            );
            if (synchronization.state !== "synced") {
              result.result.isError = true;
              result.result.content.push({
                type: "text",
                text: "The local replica retained the result, but synchronization did not complete. Inspect synchronization before reporting success.",
              });
            }
          }
          return json(result, value.status);
        }
        if (name === "render_document") {
          if (renderCount >= 2)
            return toolError(
              new Error("Two presentations are rendering. Retry shortly."),
            );
          renderCount++;
          try {
            return await execute(request, body);
          } finally {
            renderCount--;
          }
        }
        return execute(request, body);
      } catch (error) {
        return toolError(error);
      }
    },
    close() {
      authorization.close();
      artifacts.clear();
    },
  };
}

export async function startMcpHttpServer(
  options: Omit<McpHttpOptions, "publicUrl"> & {
    publicUrl?: string;
    host?: string;
    port?: number;
  },
): Promise<{ server: Server; url: string; close(): Promise<void> }> {
  let app: Awaited<ReturnType<typeof createMcpHttpApp>> | undefined;
  const server = createServer(async (incoming, outgoing) => {
    try {
      if (!app) {
        outgoing.writeHead(503);
        outgoing.end("Starting ShowAI MCP.");
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of incoming) {
        length += chunk.length;
        if (length > CAPACITY.authoringRequestBytes) {
          outgoing.writeHead(413);
          outgoing.end(
            `HTTP MCP authoring input is ${formatBytes(length)}; limit is ${formatBytes(CAPACITY.authoringRequestBytes)}.`,
          );
          return;
        }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (value)
          headers.set(name, Array.isArray(value) ? value.join(",") : value);
      const method = incoming.method ?? "GET";
      const request = new Request(
        `http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`,
        {
          method,
          headers,
          ...(!["GET", "HEAD"].includes(method)
            ? { body: Uint8Array.from(Buffer.concat(chunks)) }
            : {}),
        },
      );
      const response =
        options.durableState && new URL(request.url).pathname !== "/health"
          ? await options.durableState.run(
              () => app!.fetch(request),
              () => app!.authorization.checkpoint(),
            )
          : await app.fetch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(
        "ShowAI MCP request failed",
        error instanceof Error ? error.message : error,
      );
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end("MCP request failed.");
    }
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 8789, options.host ?? "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("MCP server has no TCP address.");
  const localUrl = `http://127.0.0.1:${address.port}`;
  try {
    await options.durableState?.restore();
    app = await createMcpHttpApp({
      ...options,
      publicUrl: options.publicUrl ?? localUrl,
      allowedHosts: [
        ...(options.allowedHosts ?? []),
        `127.0.0.1:${address.port}`,
        `localhost:${address.port}`,
      ],
    });
  } catch (error) {
    server.close();
    throw error;
  }
  return {
    server,
    url: options.publicUrl ?? localUrl,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      app?.close();
    },
  };
}

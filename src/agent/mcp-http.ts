import { createServer, type Server } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
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
import { RemoteWorkspaces } from "./mcp-workspace";
import {
  mcpSuccess,
  mcpFailure,
  type Presentation,
} from "./presentation-tools";
import { inlinePresentation } from "./presentation";
import { serverBaseUrl } from "../sync/server-url";

const writeTools = new Set([
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
  let renderCount = 0;
  const storePresentation = async (
    value: Presentation,
    publicSource = false,
  ) => {
    for (const [key, item] of artifacts)
      if (item.expires <= Date.now()) artifacts.delete(key);
    if (artifacts.size >= 100)
      throw new Error(
        "Presentation capacity reached. Retry after older previews expire.",
      );
    const key = randomBytes(32).toString("base64url"),
      expires = Date.now() + 3600_000;
    artifacts.set(key, {
      html: value.html,
      inline: value.inline,
      source: value.source,
      expires,
      publicSource,
    });
    return {
      artifactId: key,
      html: `${origin}/artifacts/${key}/page.html`,
      ...(value.inline
        ? { inline: `${origin}/artifacts/${key}/inline.html` }
        : {}),
      source: `${origin}/artifacts/${key}/page.showai.json`,
      expiresAt: new Date(expires).toISOString(),
    };
  };
  async function execute(
    request: Request,
    body: Record<string, unknown>,
    context?: { root: string; projectId: string },
    grant?: ProjectGrant,
  ) {
    const server = createMcpServer({
      root: context?.root ?? join(state, "public"),
      projectId: context?.projectId ?? "unselected",
      storeProjectPresentation: (value) => storePresentation(value, false),
      sourceContext: {
        actor: { kind: "external", label: "MCP client" },
        channel: "mcp",
      },
      instructions:
        "Use ShowAI MCP for Agent document operations. Formal content is saved in an authorized project before page_present; render_document is only for explicitly standalone output. Connection failure must not change the project or persistence mode. Public catalogs and standalone rendering require no login. Private project tools require OAuth and an explicit projectId from projects_list. Read the current page/hash/revision before modifying it. A successful shared write includes synchronization state. HTML display is optional; tools work in text-only harnesses. Use page_present only when the user wants a preview.",
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
        if (name === "guide") {
          tool.update({ _meta: { securitySchemes: [{ type: "noauth" }] } });
          return;
        }
        const shape = getObjectShape(tool.inputSchema);
        if (!shape) throw new Error(`Missing tool input schema: ${name}`);
        const original = tool.handler as ToolCallback<z.ZodRawShape>;
        const paramsSchema = {
          ...shape,
          projectId: z
            .string()
            .min(1)
            .describe(
              "Authorized shared project ID returned by projects_list.",
            ),
        };
        if ("out" in paramsSchema) delete paramsSchema.out;
        tool.update({
          paramsSchema,
          _meta: {
            ...tool._meta,
            securitySchemes: oauth(writeTools.has(name)),
          },
          callback: async (input, extra) => {
            const { projectId: _projectId, ...rest } = input;
            const args: Record<string, unknown> = rest;
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
                if ("projectId" in data) data.projectId = _projectId;
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
                      : inlinePresentation(output);
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
                  data,
                };
                result.content = result.content.map((item) =>
                  item.type === "text"
                    ? {
                        type: "text" as const,
                        text: JSON.stringify(result.structuredContent),
                      }
                    : item,
                );
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
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        _meta: { securitySchemes: oauth(false) },
      },
      async () =>
        grant
          ? mcpSuccess(await workspaces.projects(grant))
          : mcpFailure(new Error("Sign in to ShowAI.")),
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 16 * 1024 * 1024,
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
        });
      const auth = await authorization.fetch(request);
      if (auth) return auth;
      const asset = target.pathname.match(
        /^\/artifacts\/([A-Za-z0-9_-]{43})\/(page\.html|inline\.html|page\.showai\.json)$/,
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
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 16 * 1024 * 1024)
        return json({ error: "Request too large." }, 413);
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
                        writeTools.has(name ?? "")
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
            writeTools.has(name) ? "projects.write" : "projects.read",
          );
          if (name === "projects_list")
            return execute(request, body, undefined, grant);
          const project = params?.arguments?.projectId;
          if (typeof project !== "string" || !project)
            return toolError(new Error("Pass projectId from projects_list."));
          const { value, synchronization } = await workspaces.withProject(
            grant,
            project,
            writeTools.has(name),
            (context) => execute(request, body, context, grant),
          );
          const result = await value.json();
          if (result.result && !result.result.isError) {
            result.result.structuredContent = {
              ...(result.result.structuredContent ?? {}),
              synchronization,
            };
            const data = result.result.structuredContent.data;
            if (data && typeof data === "object" && data.persistence) {
              data.synchronization = synchronization;
              data.persistence.synchronized =
                synchronization.state === "synced";
            }
            result.result.content = (result.result.content ?? []).map(
              (item: { type: string; text?: string }) =>
                item.type === "text"
                  ? {
                      type: "text",
                      text: JSON.stringify(result.result.structuredContent),
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
        if (length > 16 * 1024 * 1024) {
          outgoing.writeHead(413);
          outgoing.end("Request too large.");
          return;
        }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (value)
          headers.set(name, Array.isArray(value) ? value.join(",") : value);
      const method = incoming.method ?? "GET";
      const response = await app.fetch(
        new Request(
          `http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`,
          {
            method,
            headers,
            ...(!["GET", "HEAD"].includes(method)
              ? { body: Uint8Array.from(Buffer.concat(chunks)) }
              : {}),
          },
        ),
      );
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

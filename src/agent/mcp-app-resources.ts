import { randomUUID } from "node:crypto";
import {
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const RESOURCE_URI = "showai-preview://presentation/{id}";
const MAX_PRESENTATIONS = 20;
const MAX_AGE_MS = 30 * 60_000;

export function registerMcpAppResourceDelivery(server: McpServer) {
  const presentations = new Map<string, { text: string; expiresAt: number }>();
  server.registerResource(
    "showai-app-presentation",
    new ResourceTemplate(RESOURCE_URI, { list: undefined }),
    { mimeType: "application/json" },
    (uri, { id }) => {
      const view = typeof id === "string" ? presentations.get(id) : undefined;
      if (!view || view.expiresAt <= Date.now())
        throw new Error(
          "This ShowAI preview expired. Present it again from the conversation.",
        );
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: view.text },
        ],
      };
    },
  );

  return (result: CallToolResult): CallToolResult => {
    // Cursor passes structuredContent to the app but drops result _meta.
    // Keep the reader and its data out of the model-visible tool result.
    if (server.server.getClientVersion()?.name !== "cursor-vscode")
      return result;
    const { showai, ...metadata } = result._meta ?? {};
    if (!showai || typeof showai !== "object" || !Object.keys(showai).length)
      return result;
    const now = Date.now();
    for (const [id, view] of presentations) {
      if (view.expiresAt > now) break;
      presentations.delete(id);
    }
    const oldest = presentations.keys().next().value;
    if (oldest && presentations.size >= MAX_PRESENTATIONS)
      presentations.delete(oldest);
    const id = randomUUID();
    presentations.set(id, {
      text: JSON.stringify(showai),
      expiresAt: now + MAX_AGE_MS,
    });
    return {
      ...result,
      _meta: metadata,
      structuredContent: {
        ...result.structuredContent,
        showai: { resourceUri: RESOURCE_URI.replace("{id}", id) },
      },
    };
  };
}

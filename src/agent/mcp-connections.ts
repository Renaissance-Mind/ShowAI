import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { atomicRename } from "../core/atomic-rename";

/** When an MCP client (Claude Code, Codex…) first and last reached this library. */
export interface AgentConnectionRecord {
  client: string;
  version?: string;
  /** Plugin version of the latest connection (SHOWAI_PLUGIN_VERSION from the plugin launcher). */
  pluginVersion?: string;
  /** Plugin version that made the latest tool call. */
  callPluginVersion?: string;
  firstConnectedAt: string;
  lastConnectedAt: string;
  firstCallAt?: string;
  lastCallAt?: string;
  /** Only a launcher failure was recorded; the connection times are that failure's. */
  neverConnected?: true;
  /** Latest launcher failure of this client, written before the MCP handshake. */
  lastFailure?: AgentConnectionFailure;
}

/** Written by plugins/showai/mcp/launch.mjs when it cannot start the runtime. Already redacted. */
export interface AgentConnectionFailure {
  code: string;
  message: string;
  detail?: string;
  pluginVersion?: string;
  at: string;
}

const directory = (root: string) => join(root, "local", "agent-connections");
// launch.mjs names failure records the same way with a "-failure" suffix.
function fileName(client: string) {
  const slug = client
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const digest = createHash("sha256").update(client).digest("hex").slice(0, 8);
  return `${slug || "client"}-${digest}.json`;
}

async function readRecord(path: string) {
  const text = await readFile(path, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  return text === null ? null : (JSON.parse(text) as AgentConnectionRecord);
}

export async function readAgentConnections(
  root: string,
): Promise<AgentConnectionRecord[]> {
  const names = await readdir(directory(root)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [] as string[];
      throw error;
    },
  );
  const records = new Map<string, AgentConnectionRecord>();
  const failures: (AgentConnectionFailure & { client: string })[] = [];
  for (const name of names.filter((name) => name.endsWith(".json")).sort()) {
    const path = join(directory(root), name);
    if (name.endsWith("-failure.json")) {
      const failure = JSON.parse(await readFile(path, "utf8"));
      if (
        failure?.format === "showai-connection-failure" &&
        typeof failure.client === "string" &&
        typeof failure.code === "string" &&
        typeof failure.at === "string"
      )
        failures.push(failure);
      continue;
    }
    const record = await readRecord(path);
    if (
      record &&
      typeof record.client === "string" &&
      typeof record.firstConnectedAt === "string"
    )
      records.set(record.client, record);
  }
  for (const failure of failures) {
    const { client, code, message, detail, pluginVersion, at } = failure;
    const lastFailure = {
      code,
      message: String(message ?? ""),
      ...(typeof detail === "string" ? { detail } : {}),
      ...(typeof pluginVersion === "string" ? { pluginVersion } : {}),
      at,
    };
    const record = records.get(client);
    // A host that never connected still appears with its failure.
    records.set(
      client,
      record
        ? { ...record, lastFailure }
        : {
            client,
            firstConnectedAt: at,
            lastConnectedAt: at,
            neverConnected: true,
            lastFailure,
          },
    );
  }
  return [...records.values()];
}

/** Records the connection before the MCP server sees each message. Call before connect. */
export function recordConnections(transport: Transport, root: string) {
  const recorder = new McpConnectionRecorder(root);
  const next = transport.onmessage;
  transport.onmessage = (message, extra) => {
    recorder.observe(message);
    next?.(message, extra);
  };
  return recorder;
}

/**
 * Observes one stdio MCP connection: `initialize` names the client, the first
 * `tools/call` proves the host actually used ShowAI. Records are local library
 * state, written outside the request path; a failed write never affects MCP.
 */
export class McpConnectionRecorder {
  private client?: { name: string; version?: string };
  private called = false;
  private queue: Promise<void> = Promise.resolve();
  constructor(private root: string) {}

  observe(message: JSONRPCMessage) {
    if (!("method" in message) || !("id" in message)) return;
    if (message.method === "initialize") {
      const info = (message.params as { clientInfo?: unknown } | undefined)
        ?.clientInfo as { name?: unknown; version?: unknown } | undefined;
      if (typeof info?.name !== "string" || !info.name.trim()) return;
      this.client = {
        name: info.name.trim().slice(0, 200),
        ...(typeof info.version === "string"
          ? { version: info.version.slice(0, 100) }
          : {}),
      };
      this.write("connected");
    } else if (message.method === "tools/call" && !this.called && this.client) {
      this.called = true;
      this.write("called");
    }
  }

  /** Resolves after every observed event has been written. */
  flush() {
    return this.queue;
  }

  private write(event: "connected" | "called") {
    const client = this.client!;
    const at = new Date().toISOString();
    this.queue = this.queue
      .then(async () => {
        await mkdir(directory(this.root), { recursive: true });
        const path = join(directory(this.root), fileName(client.name));
        const previous = await readRecord(path);
        const pluginVersion = process.env.SHOWAI_PLUGIN_VERSION || undefined;
        const record: AgentConnectionRecord = {
          ...previous,
          client: client.name,
          ...(client.version ? { version: client.version } : {}),
          ...(event === "connected" ? { pluginVersion } : {}),
          ...(event === "called" ? { callPluginVersion: pluginVersion } : {}),
          firstConnectedAt: previous?.firstConnectedAt ?? at,
          lastConnectedAt:
            event === "connected" ? at : (previous?.lastConnectedAt ?? at),
          ...(event === "called"
            ? { firstCallAt: previous?.firstCallAt ?? at, lastCallAt: at }
            : {}),
        };
        const temporary = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(record, null, 2) + "\n");
        await atomicRename(temporary, path);
      })
      .catch((error: Error) => {
        process.stderr.write(
          `ShowAI could not record the MCP connection: ${error.message}\n`,
        );
      });
  }
}

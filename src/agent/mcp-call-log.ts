import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import packageMetadata from "../../package.json";
import { redact } from "../core/redact";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
const digest = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? createHash("sha256").update(String(value)).digest("hex").slice(0, 24)
    : undefined;
const label = (value: unknown) =>
  typeof value === "string"
    ? redact(value)
        .replace(/[\r\n\x00-\x1f]/g, " ")
        .slice(0, 120)
    : undefined;
const identifier = (value: unknown) =>
  typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value)
    ? label(value)
    : value === undefined
      ? undefined
      : `sha256:${digest(String(value))}`;
const bytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value) ?? "");

export interface McpLoggedCall {
  fields: ObjectValue;
  started: number;
  cancelled?: boolean;
  finished?: boolean;
  errorCode?: string;
}

export interface McpLogResponse {
  value?: unknown;
  outputBytes?: number;
  httpStatus?: number;
}

export class McpCallLog {
  readonly directory: string;
  readonly path: string;
  private instanceId = randomUUID();
  private sequence = 0;
  private initialized = false;
  private pruneAt = 0;
  private warned = false;
  private client: ObjectValue = {};
  private enabled: boolean;
  constructor(
    private options: {
      directory: string;
      transport: "stdio" | "http";
      projectId?: string;
      enabled?: boolean;
      maxBytes?: number;
      files?: number;
      retentionMs?: number;
    },
  ) {
    this.enabled = options.enabled ?? process.env.SHOWAI_MCP_LOG !== "0";
    this.directory = resolve(
      process.env.SHOWAI_MCP_LOG_DIRECTORY || options.directory,
    );
    this.path = join(
      this.directory,
      `calls-${process.pid}-${this.instanceId}.jsonl`,
    );
  }

  initialize(message: unknown) {
    const request = object(message);
    if (request.method !== "initialize") return;
    const info = object(object(request.params).clientInfo);
    this.client = {
      client: label(info.name),
      clientVersion: label(info.version),
    };
  }

  begin(
    message: unknown,
    metadata: { inputBytes?: number; sessionId?: string } = {},
  ): McpLoggedCall | undefined {
    const request = object(message);
    if (
      !this.enabled ||
      request.method !== "tools/call" ||
      request.id === undefined
    )
      return;
    const params = object(request.params),
      args = object(params.arguments);
    const call: McpLoggedCall = {
      started: performance.now(),
      fields: {
        format: "showai-mcp-call",
        version: 1,
        transport: this.options.transport,
        instanceId: this.instanceId,
        sessionId:
          this.options.transport === "stdio"
            ? this.instanceId
            : digest(metadata.sessionId),
        callId: randomUUID(),
        sequence: ++this.sequence,
        requestId: digest(request.id),
        tool: identifier(params.name),
        action: identifier(args.action),
        projectId: digest(args.projectId ?? this.options.projectId),
        pageId: digest(args.pageId),
        operationId: digest(args.operationId),
        groupId: digest(args.groupId),
        inputBytes: metadata.inputBytes ?? bytes(request),
        appVersion: packageMetadata.version,
        pluginVersion: label(process.env.SHOWAI_PLUGIN_VERSION),
        host: label(process.env.SHOWAI_MCP_CLIENT),
        ...this.client,
      },
    };
    this.write({ ...call.fields, event: "started" });
    return call;
  }

  authorize(call: McpLoggedCall | undefined, grantId: string) {
    if (call) call.fields.authorizationId = digest(grantId);
  }

  finish(
    call: McpLoggedCall | undefined,
    response: McpLogResponse = {},
    failure?: "transport_error" | "interrupted",
  ) {
    if (!call || call.finished) return;
    call.finished = true;
    const envelope = object(response.value);
    const result = object(envelope.result);
    const structured = object(result.structuredContent);
    const error = object(envelope.error ?? structured.error);
    const code = call.errorCode ?? error.code;
    const failed =
      !!failure ||
      !!envelope.error ||
      result.isError === true ||
      structured.ok === false ||
      (response.httpStatus ?? 200) >= 400;
    this.write({
      ...call.fields,
      event: "completed",
      durationMs: Math.round((performance.now() - call.started) * 1000) / 1000,
      status:
        call.cancelled && failed
          ? "cancelled"
          : (failure ?? (failed ? "error" : "success")),
      errorCode: failed
        ? ((typeof code === "number" ? code : identifier(code)) ??
          (call.cancelled
            ? "REQUEST_CANCELLED"
            : failure
              ? failure.toUpperCase()
              : "TOOL_ERROR"))
        : undefined,
      outputBytes:
        response.outputBytes ??
        (response.value === undefined ? undefined : bytes(response.value)),
      httpStatus: response.httpStatus,
      migration: !!structured.migration || undefined,
    });
  }

  async run<T>(
    message: unknown,
    operation: (call: McpLoggedCall | undefined) => Promise<T>,
    describe: (value: T) => McpLogResponse,
    metadata?: { inputBytes?: number; sessionId?: string },
  ): Promise<T> {
    const call = this.begin(message, metadata);
    try {
      const value = await operation(call);
      this.finish(call, call ? describe(value) : undefined);
      return value;
    } catch (error) {
      this.finish(call, {
        value: { error: { code: object(error).code ?? "INTERNAL_ERROR" } },
        httpStatus: this.options.transport === "http" ? 500 : undefined,
      });
      throw error;
    }
  }

  private write(record: ObjectValue) {
    try {
      if (!this.initialized) {
        mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        this.initialized = true;
      }
      if (Date.now() >= this.pruneAt) {
        const cutoff = Date.now() - (this.options.retentionMs ?? 30 * 86400000);
        for (const name of readdirSync(this.directory)) {
          if (!/^calls-\d+-[a-f0-9-]{36}(?:\.\d+)?\.jsonl$/.test(name))
            continue;
          const path = join(this.directory, name);
          try {
            if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        this.pruneAt = Date.now() + 86400000;
      }
      const line =
        JSON.stringify({ ...record, at: new Date().toISOString() }) + "\n";
      let size = 0;
      try {
        size = statSync(this.path).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (
        size + Buffer.byteLength(line) >
        (this.options.maxBytes ?? 5 * 1024 * 1024)
      ) {
        const files = this.options.files ?? 3;
        const path = (index: number) =>
          index ? this.path.replace(/\.jsonl$/, `.${index}.jsonl`) : this.path;
        rmSync(path(files - 1), { force: true });
        for (let index = files - 2; index >= 0; index--) {
          try {
            renameSync(path(index), path(index + 1));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
      }
      appendFileSync(this.path, line, { mode: 0o600 });
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        process.stderr.write(
          `ShowAI MCP call log unavailable (${identifier(object(error).code) ?? "IO_ERROR"}).\n`,
        );
      }
    }
  }
}

export function recordMcpCalls(
  transport: Transport,
  root: string,
  projectId?: string,
  directory?: string,
) {
  const log = new McpCallLog({
    directory: directory ?? join(root, "local", "mcp-logs"),
    transport: "stdio",
    projectId,
  });
  const pending = new Map<string | number, McpLoggedCall>();
  const receive = transport.onmessage,
    send = transport.send.bind(transport),
    close = transport.onclose;
  transport.onmessage = (message, extra) => {
    log.initialize(message);
    const call = log.begin(message);
    if (call && "id" in message && message.id !== undefined)
      pending.set(message.id, call);
    if ("method" in message && message.method === "notifications/cancelled") {
      const requestId = object(message.params).requestId;
      if (typeof requestId === "string" || typeof requestId === "number") {
        const cancelled = pending.get(requestId);
        if (cancelled) cancelled.cancelled = true;
      }
    }
    receive?.(message, extra);
  };
  transport.send = async (message: JSONRPCMessage, options) => {
    const id =
      !("method" in message) && "id" in message ? message.id : undefined;
    const call = id === undefined ? undefined : pending.get(id);
    try {
      await send(message, options);
      log.finish(call, { value: message });
    } catch (error) {
      log.finish(call, { value: message }, "transport_error");
      throw error;
    } finally {
      if (id !== undefined) pending.delete(id);
    }
  };
  transport.onclose = () => {
    for (const call of pending.values()) log.finish(call, {}, "interrupted");
    pending.clear();
    close?.();
  };
  return log;
}

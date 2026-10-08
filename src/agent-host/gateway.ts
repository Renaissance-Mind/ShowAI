import { createServer } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { ModelSource } from "./types";

type ToolMap = Map<
  string,
  { name: string; namespace?: string; custom: boolean }
>;
export function chatRequest(input: Record<string, any>): {
  body: Record<string, any>;
  tools: ToolMap;
} {
  const tools: ToolMap = new Map(),
    definitions: any[] = [];
  const add = (tool: any, namespace?: string) => {
    if (tool.type === "namespace") {
      for (const child of tool.tools ?? []) add(child, tool.name);
      return;
    }
    if (!["function", "custom"].includes(tool.type))
      throw new Error(`Chat Completions 来源不支持工具 ${tool.type}。`);
    const alias =
      `t${tools.size}_${tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(
        0,
        64,
      );
    tools.set(alias, {
      name: tool.name,
      namespace,
      custom: tool.type === "custom",
    });
    definitions.push({
      type: "function",
      function: {
        name: alias,
        description: tool.description,
        parameters:
          tool.type === "custom"
            ? {
                type: "object",
                properties: { input: { type: "string" } },
                required: ["input"],
                additionalProperties: false,
              }
            : tool.parameters,
      },
    });
  };
  for (const tool of input.tools ?? []) add(tool);
  const messages: any[] = [];
  if (input.instructions)
    messages.push({ role: "system", content: input.instructions });
  const items =
    typeof input.input === "string"
      ? [{ role: "user", content: input.input }]
      : (input.input ?? []);
  for (const item of items) {
    if (item.type === "function_call" || item.type === "custom_tool_call") {
      const alias = [...tools].find(
        ([, tool]) =>
          tool.name === item.name && tool.namespace === item.namespace,
      )?.[0];
      if (!alias) throw new Error(`无法恢复工具调用 ${item.name}。`);
      const call = {
        id: item.call_id,
        type: "function",
        function: {
          name: alias,
          arguments:
            item.type === "custom_tool_call"
              ? JSON.stringify({ input: item.input })
              : item.arguments,
        },
      };
      const previous = messages.at(-1);
      if (previous?.role === "assistant" && previous.tool_calls)
        previous.tool_calls.push(call);
      else
        messages.push({ role: "assistant", content: null, tool_calls: [call] });
    } else if (
      item.type === "function_call_output" ||
      item.type === "custom_tool_call_output"
    ) {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content:
          typeof item.output === "string"
            ? item.output
            : JSON.stringify(item.output),
      });
    } else if (item.type === "message" || item.role) {
      const content =
        typeof item.content === "string"
          ? item.content
          : (item.content ?? []).map((part: any) => {
              if (part.type === "input_text" || part.type === "output_text")
                return { type: "text", text: part.text };
              if (part.type === "input_image" && part.image_url)
                return {
                  type: "image_url",
                  image_url: { url: part.image_url },
                };
              throw new Error(`Chat Completions 来源不支持输入 ${part.type}。`);
            });
      messages.push({
        role: item.role === "developer" ? "system" : item.role,
        content,
      });
    } else if (item.type !== "reasoning")
      throw new Error(`Chat Completions 来源不支持上下文 ${item.type}。`);
  }
  return {
    body: {
      model: input.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(definitions.length ? { tools: definitions } : {}),
    },
    tools,
  };
}

export async function* sseData(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const item = await reader.read();
      buffer += decoder
        .decode(item.value, { stream: !item.done })
        .replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) yield data;
      }
      if (item.done) break;
    }
    if (buffer.trim()) throw new Error("模型响应流未完整结束。");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
export async function* chatResponse(
  body: ReadableStream<Uint8Array>,
  tools: ToolMap,
  model: string,
) {
  const id = "resp_" + randomUUID(),
    messageId = "msg_" + randomUUID();
  let sequence = 0,
    text = "",
    terminal = false,
    messageStarted = false,
    usage: any = null;
  const calls = new Map<number, { id: string; name: string; args: string }>();
  const event = (type: string, fields: any) => ({
    type,
    sequence_number: sequence++,
    ...fields,
  });
  yield event("response.created", {
    response: {
      id,
      object: "response",
      status: "in_progress",
      model,
      output: [],
    },
  });
  for await (const data of sseData(body)) {
    if (data === "[DONE]") break;
    const chunk = JSON.parse(data);
    if (chunk.error)
      throw new Error(String(chunk.error.message ?? "模型调用失败"));
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.delta?.content) {
      if (!messageStarted) {
        messageStarted = true;
        yield event("response.output_item.added", {
          output_index: 0,
          item: {
            id: messageId,
            type: "message",
            role: "assistant",
            status: "in_progress",
            content: [],
          },
        });
        yield event("response.content_part.added", {
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        });
      }
      text += choice.delta.content;
      yield event("response.output_text.delta", {
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        delta: choice.delta.content,
      });
    }
    for (const call of choice.delta?.tool_calls ?? []) {
      const saved = calls.get(call.index) ?? {
        id: call.id ?? "call_" + randomUUID(),
        name: "",
        args: "",
      };
      saved.name += call.function?.name ?? "";
      saved.args += call.function?.arguments ?? "";
      calls.set(call.index, saved);
    }
    if (choice.finish_reason) {
      if (!["stop", "tool_calls"].includes(choice.finish_reason))
        throw new Error(`模型未完成响应：${choice.finish_reason}`);
      terminal = true;
    }
  }
  if (!terminal) throw new Error("模型响应流中断，未收到完成事件。");
  const output: any[] = [];
  if (messageStarted) {
    const item = {
      id: messageId,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
    };
    yield event("response.output_text.done", {
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      text,
    });
    yield event("response.content_part.done", {
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      part: item.content[0],
    });
    yield event("response.output_item.done", { output_index: 0, item });
    output.push(item);
  }
  for (const call of calls.values()) {
    const mapped = tools.get(call.name);
    if (!mapped) throw new Error(`模型调用了未知工具 ${call.name}。`);
    const item = {
      type: mapped.custom ? "custom_tool_call" : "function_call",
      id: "fc_" + randomUUID(),
      call_id: call.id,
      name: mapped.name,
      ...(mapped.namespace ? { namespace: mapped.namespace } : {}),
      ...(mapped.custom
        ? { input: JSON.parse(call.args).input }
        : { arguments: call.args }),
    };
    const output_index = output.length;
    yield event("response.output_item.added", { output_index, item });
    yield event("response.output_item.done", { output_index, item });
    output.push(item);
  }
  yield event("response.completed", {
    response: {
      id,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model,
      output,
      usage: usage
        ? {
            input_tokens: usage.prompt_tokens ?? 0,
            output_tokens: usage.completion_tokens ?? 0,
            total_tokens: usage.total_tokens ?? 0,
          }
        : { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    },
  });
}

/** A task-scoped loopback gateway keeps provider secrets outside the Codex child process. */
export async function startModelGateway(
  source: ModelSource,
  credential: (force?: boolean) => Promise<string>,
) {
  const secret = randomBytes(32).toString("hex");
  const server = createServer((request, response) => {
    const run = async () => {
      const token = Buffer.from(request.headers.authorization ?? ""),
        expected = Buffer.from("Bearer " + secret);
      if (
        token.length !== expected.length ||
        !timingSafeEqual(token, expected)
      ) {
        response.writeHead(401);
        response.end();
        return;
      }
      if (request.method !== "POST" || request.url !== "/v1/responses") {
        response.writeHead(404);
        response.end();
        return;
      }
      const abort = new AbortController();
      response.once("close", () => abort.abort());
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 24 * 1024 * 1024)
          throw new Error("Model request exceeds 24 MB.");
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString());
      const translated =
        source.protocol === "chat" ? chatRequest(input) : undefined;
      const endpoint =
        source.baseUrl.replace(/\/$/, "") +
        (translated ? "/chat/completions" : "/responses");
      const send = async (force = false) =>
        fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + (await credential(force)),
            ...(source.provider === "openrouter"
              ? { "X-Title": "ShowAI" }
              : {}),
          },
          body: JSON.stringify(
            translated?.body ?? { ...input, store: false, stream: true },
          ),
          signal: AbortSignal.any([
            abort.signal,
            AbortSignal.timeout(10 * 60 * 1000),
          ]),
          redirect: "error",
        });
      let upstream = await send();
      if (upstream.status === 401 && source.credential === "chatgpt") {
        await upstream.body?.cancel();
        upstream = await send(true);
      }
      if (!upstream.ok) {
        response.writeHead(upstream.status, {
          "content-type": "application/json",
        });
        response.end(
          JSON.stringify({
            error: { message: `模型服务拒绝调用：HTTP ${upstream.status}` },
          }),
        );
        await upstream.body?.cancel();
        return;
      }
      if (!upstream.body) throw new Error("Missing provider response body.");
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
      });
      if (translated) {
        for await (const event of chatResponse(
          upstream.body,
          translated.tools,
          input.model,
        ))
          response.write(
            `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          );
      } else for await (const chunk of upstream.body) response.write(chunk);
      response.end();
    };
    void run().catch((error: Error) => {
      if (response.destroyed) return;
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: error.message } }));
      } else
        response.end(
          `event: response.failed\ndata: ${JSON.stringify({ type: "response.failed", response: { status: "failed", error: { code: "provider_failed", message: error.message } } })}\n\n`,
        );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing gateway address.");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    secret,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

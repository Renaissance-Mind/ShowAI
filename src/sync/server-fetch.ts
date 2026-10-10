import { Agent, request } from "undici";
import { Readable } from "node:stream";

let dispatcher: Agent | undefined;

/** Reuse bounded connections for sync and account requests. TLS negotiates HTTP/2
 * where available; ordinary HTTP/1.1 Linux deployments use the same handler. */
export async function serverFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  dispatcher ??= new Agent({
    allowH2: true,
    connections: 4,
    pipelining: 100,
    maxConcurrentStreams: 100,
  });
  const supplied = init?.body;
  if (
    supplied !== undefined &&
    supplied !== null &&
    typeof supplied !== "string" &&
    !(supplied instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(supplied)
  )
    return fetch(input, { ...init, dispatcher } as RequestInit);
  const body =
    typeof supplied === "string"
      ? Buffer.from(supplied)
      : supplied instanceof ArrayBuffer
        ? Buffer.from(supplied)
        : ArrayBuffer.isView(supplied)
          ? Buffer.from(
              supplied.buffer,
              supplied.byteOffset,
              supplied.byteLength,
            )
          : undefined;
  const method = (init?.method ?? "GET").toUpperCase();
  const url = new URL(input);
  // These POSTs only inspect authority and immutable content references. Other
  // POSTs (login, grants, refresh and publication) must never be auto-retried.
  const inspection =
    method === "POST" &&
    /\/api\/projects\/(?:heads|[^/]+\/objects\/check)$/.test(url.pathname);
  const headers = new Headers(init?.headers);
  headers.set("accept-encoding", "identity");
  const response = await request(url, {
    dispatcher,
    method: method as NonNullable<Parameters<typeof request>[1]>["method"],
    headers: Object.fromEntries(headers),
    body,
    signal: init?.signal,
    idempotent: inspection || method === "GET" || method === "HEAD",
  }).catch((error: unknown) => {
    if (init?.signal?.aborted) throw init.signal.reason;
    throw new TypeError(
      error instanceof Error ? error.message : "同步网络请求失败。",
      { cause: error },
    );
  });
  if (
    response.statusCode >= 300 &&
    response.statusCode < 400 &&
    init?.redirect !== "manual"
  ) {
    await response.body.dump();
    throw new TypeError("服务器地址发生重定向，请使用最终服务器基址重新连接。");
  }
  const resultHeaders = new Headers();
  for (const [name, value] of Object.entries(response.headers))
    if (value !== undefined)
      resultHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
  const empty =
    method === "HEAD" || [204, 205, 304].includes(response.statusCode);
  if (empty) await response.body.dump();
  return new Response(
    empty
      ? null
      : (Readable.toWeb(response.body) as ReadableStream<Uint8Array>),
    {
      status: response.statusCode,
      headers: resultHeaders,
    },
  );
}

export async function closeServerTransport() {
  const current = dispatcher;
  dispatcher = undefined;
  await current?.close();
}

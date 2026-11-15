import { Agent, request } from "undici";
import { Readable } from "node:stream";
import { translator } from "../i18n";
import syncEngineMessages from "../i18n/messages/syncEngine";

const t = translator(syncEngineMessages);

let dispatcher: Agent | undefined;

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
    throw new TypeError(t("network.failed"), { cause: error });
  });
  if (
    response.statusCode >= 300 &&
    response.statusCode < 400 &&
    init?.redirect !== "manual"
  ) {
    await response.body.dump();
    throw new TypeError(t("network.redirected"));
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

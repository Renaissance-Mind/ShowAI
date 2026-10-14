const maximumBytes = 16 * 1024 * 1024;
async function authorized(request, key) {
  const hash = async (value) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  const actual = await hash(request.headers.get("authorization") ?? ""),
    expected = await hash(`Bearer ${key}`);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
/** Only encrypted state objects cross this private broker; never serves content anonymously. */
export async function stateRequest(request, env) {
  const key = new URL(request.url).pathname.match(
    /^\/__state\/(head|[a-f0-9]{64})$/,
  )?.[1];
  if (
    !key ||
    !env.SHOWAI_MCP_STATE_KEY ||
    !(await authorized(request, env.SHOWAI_MCP_STATE_KEY))
  )
    return new Response("Not found.", { status: 404 });
  const path = "mcp-state/v1/" + key;
  if (request.method === "GET") {
    const value = await env.STATE.get(path);
    return value
      ? new Response(value.body, {
          headers: {
            "cache-control": "no-store",
            "content-type": "application/octet-stream",
          },
        })
      : new Response(null, { status: 404 });
  }
  if (request.method === "PUT") {
    const reader = request.body?.getReader(),
      parts = [];
    let size = 0;
    if (!reader) return new Response("Missing state object.", { status: 400 });
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        return new Response("State object is too large.", { status: 413 });
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    await env.STATE.put(path, bytes);
    return new Response(null, { status: 204 });
  }
  return new Response("Method not allowed.", { status: 405 });
}

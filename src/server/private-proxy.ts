interface PrivateProxyEnvironment {
  PRIVATE_ORIGIN: string;
  /** Shared with the Linux server's SHOWAI_TRUSTED_PROXY_KEY to vouch for client addresses. */
  PROXY_KEY?: string;
}

/** Only the explicitly routed private-service prefix reaches the tunnel. The
 * Linux server keeps account, project and operations authorization authority. */
export default {
  async fetch(request: Request, env: PrivateProxyEnvironment) {
    const source = new URL(request.url);
    if (
      source.pathname !== "/private" &&
      !source.pathname.startsWith("/private/")
    )
      return new Response("Not found", { status: 404 });
    if (source.protocol !== "https:") {
      source.protocol = "https:";
      return Response.redirect(source.href, 308);
    }
    const origin = new URL(env.PRIVATE_ORIGIN);
    if (
      (origin.protocol !== "https:" &&
        !(
          origin.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
        )) ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/"
    )
      throw new Error("Configure a trusted HTTPS tunnel origin.");
    origin.pathname = source.pathname;
    origin.search = source.search;
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("x-showai-client-ip");
    headers.delete("x-showai-proxy-key");
    // Every request reaches the tunnel from this proxy, so the origin needs the
    // visitor's address to keep per-source limits per person.
    const client = request.headers.get("cf-connecting-ip");
    if (env.PROXY_KEY && client) {
      headers.set("x-showai-client-ip", client);
      headers.set("x-showai-proxy-key", env.PROXY_KEY);
    }
    return fetch(
      new Request(origin.href, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
        duplex: "half",
      } as RequestInit),
    );
  },
};

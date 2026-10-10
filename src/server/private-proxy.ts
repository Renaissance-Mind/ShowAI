interface PrivateProxyEnvironment {
  PRIVATE_ORIGIN: string;
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

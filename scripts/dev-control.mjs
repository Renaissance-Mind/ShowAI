/** Loopback control channel for reusing the same source development app. */
export function developmentControl(origin, state, focus, next) {
  return (request, response) => {
    const path = new URL(request.url ?? "/", origin).pathname;
    if (!path.startsWith("/__showai-dev/")) return next(request, response);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    if (
      request.headers.host !== new URL(origin).host ||
      (request.headers.origin && request.headers.origin !== origin)
    ) {
      response.writeHead(403);
      response.end(JSON.stringify({ error: "Forbidden origin" }));
      return;
    }
    if (path === "/__showai-dev/status" && request.method === "GET") {
      response.end(
        JSON.stringify({ protocol: "showai-development-v1", ...state() }),
      );
      return;
    }
    if (path === "/__showai-dev/focus" && request.method === "POST") {
      if (!state().ready) {
        response.writeHead(409);
        response.end(JSON.stringify({ error: "Development app is not ready" }));
        return;
      }
      const url = new URL(request.url, origin).searchParams.get("url");
      if (url && !url.startsWith("showai://project/")) {
        response.writeHead(400);
        response.end(JSON.stringify({ error: "Invalid ShowAI page URL" }));
        return;
      }
      focus(url);
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ error: "Unknown development request" }));
  };
}

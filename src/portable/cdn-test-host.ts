import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { createServer } from "node:http";

/**
 * Serves a CDN reader build with CORS plus registered host pages. A host page
 * embeds a fragment in an iframe that allows only inline scripts and this
 * server's origin, like a conversation surface that permits one CDN.
 */
export async function startCdnHost(outdir: string) {
  const pages = new Map<string, string>();
  const delayed = new Map<ReturnType<typeof setTimeout>, () => void>();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://host");
    const path = url.pathname;
    if (pages.has(path)) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      return response.end(pages.get(path));
    }
    try {
      const delay = Number(url.searchParams.get("delay") ?? 0);
      if (!Number.isInteger(delay) || delay < 0 || delay > 30_000)
        throw new Error("Invalid test response delay");
      if (delay)
        await new Promise<void>((done) => {
          const timer = setTimeout(() => {
            delayed.delete(timer);
            done();
          }, delay);
          delayed.set(timer, done);
        });
      const file = normalize(join(outdir, path));
      if (!file.startsWith(outdir)) throw new Error("outside");
      response.setHeader("Content-Type", "text/javascript");
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.end(await readFile(file));
    } catch {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    /** Registers a page at `path`; `fragment` goes inside the strict iframe. */
    host(path: string, fragment: string, height = 900) {
      const source =
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${origin}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'">${fragment}`
          .replaceAll("&", "&amp;")
          .replaceAll('"', "&quot;");
      pages.set(
        path,
        `<iframe title="Host" sandbox="allow-scripts allow-same-origin" style="width:1000px;height:${height}px" srcdoc="${source}"></iframe>`,
      );
      return `${origin}${path}`;
    },
    /** Registers a complete HTML page at `path`. */
    page(path: string, html: string) {
      pages.set(path, html);
      return `${origin}${path}`;
    },
    close: () => {
      for (const [timer, done] of delayed) {
        clearTimeout(timer);
        done();
      }
      delayed.clear();
      return new Promise((done) => server.close(done));
    },
  };
}

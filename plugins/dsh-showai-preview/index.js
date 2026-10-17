/**
 * ShowAI inline page preview — Host half.
 *
 * A ShowAI presentation tool (`page_present` / `render_document`) answers with a
 * delivery record: the compiled page was written to disk, and only the *paths*
 * are on the wire (`data.delivery.inline` / `data.delivery.html`). The Harness
 * model-facing projection keeps the tool's text blocks and drops the MCP
 * `_meta.showai.inline` payload that an MCP Apps host would render, so the
 * browser cannot see the page on its own.
 *
 * This half closes that gap without touching the wire contract:
 *
 * 1. observe the settled result of a ShowAI presentation tool and copy the
 *    delivered HTML into a plugin-owned cache under `$DSH_HOME/cache/showai-page`;
 * 2. serve that cache from a dedicated loopback origin (`127.0.0.1:<random>`),
 *    so the page runs in its own origin instead of the Harness page origin and
 *    cannot reach the application DOM, session data or `/api`;
 * 3. expose one same-origin route on the Harness web server that answers a
 *    `HEAD` probe from the cache and `302`s a real load to the preview origin
 *    (the browser gets no CORS access to that origin, only a navigation).
 *
 * `delivery.inline` is an *inline reader fragment*: it starts at a `<section>`
 * and relies on the embedding host to supply the surrounding document. Framing
 * that fragment directly puts the preview into quirks mode, which breaks KaTeX
 * and changes layout (`document.compatMode === "BackCompat"`). The cache
 * therefore stores a complete document: full deliveries are kept byte-for-byte,
 * and inline fragments get a doctype, head and body shell. Legacy fragment
 * cache entries are wrapped on read, so replaying an old transcript also
 * renders in standards mode.
 *
 * The preview is therefore durable across restarts: the cache survives, so
 * replaying an old transcript still renders the page it presented.
 */
import { createServer } from "node:http";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Same-origin route the browser asks for; the Host answers it and redirects a load. */
export const PREVIEW_ROUTE = "/showai-page-preview";
/** Wire tools whose settled result carries a ShowAI presentation delivery. */
const PRESENTATION_TOOL = /^mcp__[A-Za-z0-9_-]+__(?:page_present|render_document)$/;
/** Preview files kept in the cache; older ones are dropped after each write. */
const MAX_PREVIEWS = 40;
/** A preview above this size is not cached (the fallback surface opens the file instead). */
const MAX_PREVIEW_BYTES = 12 * 1024 * 1024;
/** Preview file names are opaque ids; nothing else is servable. */
const PREVIEW_NAME = /^[A-Za-z0-9_-]{1,96}\.html$/;
/** The fragment's own language, when it carries one. */
const FRAGMENT_LANGUAGE = /<section\b[^>]*\blang="([A-Za-z0-9-]{1,32})"/i;

/**
 * The preview cache directory.
 * @returns the absolute cache path for this Harness home.
 */
function cacheRoot() {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  return join(home, "cache", "showai-page");
}

/**
 * The one file-name rule shared with the Client half (see `client.js`).
 * @param callId - the tool call id that produced the presentation.
 * @returns a safe, collision-free cache file name.
 */
function fileNameFor(callId) {
  return `${String(callId).replace(/[^A-Za-z0-9_-]/g, "_")}.html`;
}

/** Escape text that becomes document metadata. */
function escapeHtmlText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Turn a delivered file into a complete HTML document.
 *
 * `delivery.html` and the compressed online reader can already be complete
 * documents; those are returned byte-for-byte. `delivery.inline` is normally a
 * `<section>` fragment intended for another host's document, so it gets the
 * smallest standards-mode shell it needs. Loading it directly is what put the
 * preview into quirks mode.
 *
 * @param body - the delivered HTML bytes.
 * @param title - the presentation title, when the result carries one.
 * @returns complete HTML bytes.
 */
export function completePreviewDocument(body, title) {
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
  const head = text.slice(0, 4096);
  const leading = head.replace(/^\uFEFF?\s*(?:<!--[\s\S]*?-->\s*)*/i, "");
  if (/^<!doctype\s+html/i.test(leading)) {
    return Buffer.isBuffer(body) ? body : Buffer.from(text, "utf8");
  }
  if (/^<html(?:\s|>)/i.test(leading)) {
    return Buffer.from(`<!doctype html>${text}`, "utf8");
  }
  const language = FRAGMENT_LANGUAGE.exec(head)?.[1] ?? "en";
  const label = escapeHtmlText(title === undefined || title === "" ? "ShowAI page" : title);
  return Buffer.from(
    `<!doctype html><html lang="${language}"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${label}</title><style>html,body{margin:0;padding:0}body{min-height:100vh}</style>` +
      `</head><body>${text}</body></html>`,
    "utf8",
  );
}

/**
 * Read the delivery record out of one settled tool result.
 * @param result - the frozen `tools/result` outcome.
 * @returns the source HTML path and label, or undefined for an unrelated result.
 */
function presentationFromResult(result) {
  if (result === undefined || result === null || result.isError === true) {
    return undefined;
  }
  const blocks = Array.isArray(result.content) ? result.content : [];
  for (const block of blocks) {
    if (block?.type !== "text" || typeof block.text !== "string") continue;
    let body;
    try {
      body = JSON.parse(block.text);
    } catch {
      continue;
    }
    const data = body?.ok === true ? body.data : undefined;
    const delivery = data?.delivery;
    if (delivery === null || typeof delivery !== "object") continue;
    const source =
      typeof delivery.inline === "string"
        ? delivery.inline
        : typeof delivery.html === "string"
          ? delivery.html
          : undefined;
    if (source === undefined) continue;
    return {
      source,
      title: typeof data.title === "string" ? data.title : undefined,
    };
  }
  return undefined;
}

/**
 * Keep only the newest preview files.
 * @param root - the preview cache directory.
 */
async function prune(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !PREVIEW_NAME.test(entry.name)) continue;
    const info = await stat(join(root, entry.name)).catch(() => undefined);
    if (info !== undefined) files.push({ path: join(root, entry.name), time: info.mtimeMs });
  }
  files.sort((left, right) => right.time - left.time);
  for (const file of files.slice(MAX_PREVIEWS)) {
    await rm(file.path, { force: true }).catch(() => {});
  }
}

/**
 * Copy one delivered page into the preview cache as a complete document.
 * @param callId - the tool call id owning the preview.
 * @param presentation - the parsed delivery record.
 * @param root - the preview cache directory.
 */
async function cachePreview(callId, presentation, root) {
  const body = completePreviewDocument(await readFile(presentation.source), presentation.title);
  if (body.byteLength === 0 || body.byteLength > MAX_PREVIEW_BYTES) {
    throw new Error(`preview is ${body.byteLength} bytes; outside the cache budget`);
  }
  await mkdir(root, { recursive: true });
  const name = fileNameFor(callId);
  const target = join(root, name);
  const temporary = join(root, `.${name}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, body);
    // Publish atomically so a HEAD probe never sees a half-written document.
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  await prune(root);
}

/**
 * Read a cached preview as a complete document, wrapping legacy fragments.
 * @param name - the validated cache file name.
 * @returns the servable HTML bytes.
 */
async function readPreview(name) {
  return completePreviewDocument(await readFile(join(cacheRoot(), name)));
}

/**
 * Start the isolated preview origin.
 * @param log - the plugin logger.
 * @returns the listening server and port, or undefined when binding failed.
 */
function startPreviewOrigin(log) {
  const server = createServer((request, response) => {
    void (async () => {
      let name = "";
      try {
        name = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname.slice(1));
      } catch {
        name = "";
      }
      if (!PREVIEW_NAME.test(name)) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("not found");
        return;
      }
      let body;
      try {
        body = await readPreview(name);
      } catch {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("not found");
        return;
      }
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(body.byteLength),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    })().catch((error) => {
      response.destroy(error);
    });
  });
  return new Promise((resolve) => {
    server.once("error", (error) => {
      log?.warn?.(`showai-page: preview origin unavailable: ${error?.message ?? error}`);
      resolve(undefined);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address !== null && typeof address === "object" ? address.port : undefined;
      resolve({ server, port });
    });
  });
}

/**
 * The preview needs the Web carrier: without `webServer` the page has no
 * address to reach the cached HTML, so the row stays inactive in a headless
 * composition instead of activating a service it cannot use.
 */
export const inject = ["webServer"];

/**
 * Host half of the ShowAI inline page preview.
 * @param ctx - the plugin context.
 */
export function apply(ctx) {
  const log = ctx.logger;
  const root = cacheRoot();
  const ready = (async () => {
    await mkdir(root, { recursive: true });
    await prune(root);
    return startPreviewOrigin(log);
  })().catch((error) => {
    log?.warn?.(`showai-page: preview origin failed to start: ${error?.message ?? error}`);
    return undefined;
  });

  ctx.effect(
    () => () => {
      void ready.then((origin) => origin?.server.close());
    },
    "showai-page: preview origin",
  );

  ctx.on("tools/result", (exec, result) => {
    if (exec.parent !== undefined || !PRESENTATION_TOOL.test(exec.name)) return;
    const presentation = presentationFromResult(result);
    if (presentation === undefined) return;
    void cachePreview(exec.callId, presentation, root).catch((error) => {
      log?.warn?.(
        `showai-page: could not cache the preview for ${exec.callId}: ${error?.message ?? error}`,
      );
    });
  });

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: PREVIEW_ROUTE,
        handler: async (request, response) => {
          const origin = await ready;
          let name = "";
          try {
            name = decodeURIComponent(
              new URL(request.url ?? "/", "http://127.0.0.1").pathname.slice(PREVIEW_ROUTE.length + 1),
            );
          } catch {
            name = "";
          }
          const exists =
            origin !== undefined &&
            PREVIEW_NAME.test(name) &&
            (await stat(join(root, name)).then(
              (info) => info.isFile(),
              () => false,
            ));
          if (!exists) {
            response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            response.end("not found");
            return;
          }
          if (request.method === "HEAD") {
            response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
            response.end();
            return;
          }
          response.writeHead(302, {
            location: `http://127.0.0.1:${origin.port}/${name}`,
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
          });
          response.end();
        },
      }),
    "showai-page: preview route",
  );
}

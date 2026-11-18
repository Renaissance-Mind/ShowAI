import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const PREVIEW_ROUTE = "/showai-page-preview";
const PRESENTATION_TOOL = /^mcp__showai__(?:page_present|render_document|show_component)$/;
const MAX_PREVIEWS = 40;
const MAX_PREVIEW_BYTES = 12 * 1024 * 1024;
const SIMPLE_ID = /^[A-Za-z0-9_-]{1,96}$/;
const PREVIEW_NAME = /^(?:[A-Za-z0-9_-]{1,96}|id\.[a-f0-9]{64})\.html$/;
const FRAGMENT_LANGUAGE = /<section\b[^>]*\blang="([A-Za-z0-9-]{1,32})"/i;

function cacheRoot() {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  return join(home, "cache", "showai-page");
}

function fileNameFor(callId) {
  const id = String(callId);
  return SIMPLE_ID.test(id)
    ? id + ".html"
    : "id." + createHash("sha256").update(id).digest("hex") + ".html";
}

function escapeHtmlText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

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

async function cachePreview(callId, presentation, root) {
  const { size } = await stat(presentation.source);
  if (size > MAX_PREVIEW_BYTES) throw new Error(`preview is ${size} bytes; outside the cache budget`);
  const body = completePreviewDocument(await readFile(presentation.source), presentation.title);
  if (body.byteLength === 0 || body.byteLength > MAX_PREVIEW_BYTES) {
    throw new Error(`preview is ${body.byteLength} bytes; outside the cache budget`);
  }
  await mkdir(root, { recursive: true });
  const name = fileNameFor(callId);
  const target = join(root, name);
  const temporary = join(root, `.${name}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, body);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  await prune(root);
}

function startPreviewOrigin(root, log) {
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
        body = completePreviewDocument(await readFile(join(root, name)));
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

export const inject = ["webServer"];

export function apply(ctx) {
  const log = ctx.logger;
  const root = cacheRoot();
  const ready = (async () => {
    await mkdir(root, { recursive: true });
    await prune(root);
    return startPreviewOrigin(root, log);
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
    if (!PRESENTATION_TOOL.test(exec.name) || exec.callId == null || exec.callId === "") return;
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
            const url = new URL(request.url ?? "/", "http://127.0.0.1");
            const callId = url.searchParams.get("callId");
            name = url.pathname === PREVIEW_ROUTE + "/by-id" && callId
              ? fileNameFor(callId)
              : decodeURIComponent(url.pathname.slice(PREVIEW_ROUTE.length + 1));
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

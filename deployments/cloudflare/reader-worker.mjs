// ShowAI reader source: serves immutable showai-reader builds from R2.
// A version is copied from the npm registry the first time it is requested,
// after checking the registry's sha512 integrity, so publishing stays a single
// npm release and this host needs no upload credentials.

const PACKAGE = "showai-reader";
const REGISTRY = "https://registry.npmjs.org";
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const FILE = /^(?:[\w.-]+\/)*[\w.-]+$/;
const TYPES = {
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  woff2: "font/woff2",
};
const shared = {
  "access-control-allow-origin": "*",
  "cross-origin-resource-policy": "cross-origin",
  "x-content-type-options": "nosniff",
};

function contentType(path) {
  const extension = path.split(".").pop().toLowerCase();
  return TYPES[extension] ?? (/LEGAL|LICENSE/.test(path) ? TYPES.txt : "application/octet-stream");
}

function notFound(message, maxAge = 60) {
  return new Response(message, {
    status: 404,
    headers: { ...shared, "content-type": TYPES.txt, "cache-control": `public, max-age=${maxAge}` },
  });
}

/** Parses /showai-reader@VERSION/PATH; anything else is rejected. */
export function readerPath(pathname) {
  const match = /^\/([^/@]+)@([^/]+)\/(.+)$/.exec(pathname);
  if (!match || match[1] !== PACKAGE || !VERSION.test(match[2])) return null;
  const file = decodeURIComponent(match[3]);
  // Dot files (including the import marker) are never served.
  if (!FILE.test(file) || file.split("/").some((part) => part.startsWith(".")))
    return null;
  return { version: match[2], file };
}

const octal = (bytes) => parseInt(new TextDecoder().decode(bytes).replace(/\0.*$/, "").trim() || "0", 8);
const text = (bytes) => new TextDecoder().decode(bytes).replace(/\0.*$/, "");

/** Regular files of a ustar archive, including PAX path overrides. */
export function* tarEntries(archive) {
  let offset = 0,
    paxPath;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return;
    const size = octal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] || 48);
    const name = text(header.subarray(0, 100));
    const prefix = text(header.subarray(345, 500));
    const body = archive.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      for (const record of new TextDecoder().decode(body).split("\n")) {
        const value = /^\d+ path=(.*)$/.exec(record);
        if (value) paxPath = value[1];
      }
      continue;
    }
    if (type === "g") continue;
    const path = paxPath ?? (prefix ? `${prefix}/${name}` : name);
    paxPath = undefined;
    if (type === "0" || type === "\0") yield { path, body };
  }
}

async function readAll(stream) {
  const chunks = [];
  let length = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Copies one published version into the bucket; returns false if npm lacks it. */
export async function importVersion(version, bucket, fetcher = fetch) {
  const meta = await fetcher(`${REGISTRY}/${PACKAGE}/${version}`, {
    headers: { accept: "application/json" },
  });
  if (meta.status === 404) return false;
  if (!meta.ok) throw new Error(`npm registry answered ${meta.status}`);
  const { dist, version: published } = await meta.json();
  if (published !== version || !dist?.tarball || !/^sha512-/.test(dist.integrity ?? ""))
    throw new Error("npm metadata does not describe this version.");
  const tarball = new URL(dist.tarball);
  if (tarball.origin !== REGISTRY || !tarball.pathname.startsWith(`/${PACKAGE}/-/`))
    throw new Error("Unexpected tarball location.");
  const response = await fetcher(tarball.href);
  if (!response.ok) throw new Error(`npm tarball answered ${response.status}`);
  const packed = new Uint8Array(await response.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", packed));
  if (`sha512-${base64(digest)}` !== dist.integrity)
    throw new Error("npm tarball failed its integrity check.");
  const archive = await readAll(
    new Blob([packed]).stream().pipeThrough(new DecompressionStream("gzip")),
  );
  const entries = [...tarEntries(archive)].filter(
    ({ path }) => path.startsWith("package/") && FILE.test(path.slice(8)),
  );
  // Parallel writes keep the first request of a new version short.
  for (let i = 0; i < entries.length; i += 8)
    await Promise.all(
      entries.slice(i, i + 8).map(({ path, body }) =>
        bucket.put(`${PACKAGE}/${version}/${path.slice(8)}`, body, {
          httpMetadata: { contentType: contentType(path.slice(8)) },
        }),
      ),
    );
  const files = entries.length;
  if (!files) throw new Error("npm tarball contained no package files.");
  await bucket.put(`${PACKAGE}/${version}/.complete`, String(files));
  return true;
}

export async function handle(request, env, fetcher = fetch) {
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: { ...shared, "access-control-allow-methods": "GET, HEAD", "access-control-max-age": "86400" },
    });
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method not allowed", { status: 405, headers: shared });
  const url = new URL(request.url);
  if (url.pathname === "/")
    return new Response("ShowAI reader source\n", {
      headers: { ...shared, "content-type": TYPES.txt, "cache-control": "public, max-age=300" },
    });
  const target = readerPath(url.pathname);
  if (!target) return notFound("Not a ShowAI reader file.", 3600);
  const key = `${PACKAGE}/${target.version}/${target.file}`;
  let object = await env.READER.get(key);
  if (!object && !(await env.READER.head(`${PACKAGE}/${target.version}/.complete`))) {
    if (!(await importVersion(target.version, env.READER, fetcher)))
      return notFound("This reader version is not published.");
    object = await env.READER.get(key);
  }
  if (!object) return notFound("This file is not part of the reader.", 3600);
  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: {
      ...shared,
      "content-type": object.httpMetadata?.contentType ?? contentType(target.file),
      "cache-control": "public, max-age=31536000, immutable",
      etag: object.httpEtag,
    },
  });
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      return new Response(`Reader source error: ${error.message}`, {
        status: 502,
        headers: { ...shared, "content-type": TYPES.txt, "cache-control": "no-store" },
      });
    }
  },
};

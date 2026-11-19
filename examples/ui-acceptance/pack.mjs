import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

function attributes(source) {
  const result = new Map();
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of source.matchAll(pattern))
    result.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]);
  return result;
}

function isEmbedded(value, allowData = true) {
  const normalized = value.trim();
  return (
    /^(?:#|about:blank$)/i.test(normalized) ||
    (allowData && /^data:/i.test(normalized))
  );
}

function srcsetUrls(value) {
  const urls = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /[\s,]/.test(value[index])) index++;
    const start = index;
    const data = value.slice(index, index + 5).toLowerCase() === "data:";
    while (
      index < value.length &&
      !/\s/.test(value[index]) &&
      (data || value[index] !== ",")
    )
      index++;
    const url = value.slice(start, index).replace(/,+$/, "");
    if (url) urls.push(url);
    if (value[index] === ",") continue;
    while (index < value.length && value[index] !== ",") index++;
  }
  return urls;
}

export function findExternalAssets(html) {
  const found = [];
  function add(kind, value, allowData = true) {
    if (value && !isEmbedded(value, allowData)) found.push(kind + ": " + value);
  }
  function css(source) {
    for (const match of source.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi))
      add("CSS url", match[2]);
    for (const match of source.matchAll(
      /@import\s+(?:url\(\s*(['"]?)(.*?)\1\s*\)|(['"])(.*?)\3)/gi,
    ))
      add("CSS @import", match[2] ?? match[4], false);
  }
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const withoutScripts = withoutComments.replace(
    /<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi,
    (_, raw) => {
      add("script", attributes(raw).get("src"), false);
      return "";
    },
  );
  const withoutStyles = withoutScripts.replace(
    /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,
    (_, content) => {
      css(content);
      return "";
    },
  );
  for (const match of withoutStyles.matchAll(/<([\w-]+)\b([^>]*)>/g)) {
    const tag = match[1].toLowerCase();
    const attrs = attributes(match[2]);
    if (attrs.has("style")) css(attrs.get("style"));
    if (["img", "source", "video", "audio", "track", "input"].includes(tag))
      add(tag + " src", attrs.get("src"));
    if (["script", "iframe", "embed"].includes(tag))
      add(tag + " src", attrs.get("src"), false);
    const rel = (attrs.get("rel") || "").toLowerCase().split(/\s+/);
    if (
      tag === "link" &&
      rel.some((value) =>
        [
          "stylesheet",
          "icon",
          "preload",
          "modulepreload",
          "prefetch",
          "manifest",
        ].includes(value),
      )
    )
      add("link href", attrs.get("href"), rel.includes("icon"));
    if (tag === "object") add("object data", attrs.get("data"), false);
    if (tag === "video") add("video poster", attrs.get("poster"));
    if (attrs.has("srcset")) {
      for (const candidate of srcsetUrls(attrs.get("srcset")))
        add(tag + " srcset", candidate);
    }
  }
  return [...new Set(found)];
}

function git(directory, ...args) {
  const result = spawnSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function sourceMetadata(directory) {
  const root = git(directory, "rev-parse", "--show-toplevel");
  if (!root) return {};
  const revision = git(root, "rev-parse", "HEAD");
  const branch = git(root, "branch", "--show-current") || "";
  const status = git(
    root,
    "status",
    "--porcelain=v1",
    "--untracked-files=normal",
  );
  const checkout = root.split(sep).filter(Boolean).slice(-3).join("/");
  return {
    checkout,
    branch,
    revision,
    dirty: status === null ? undefined : !!status,
  };
}

export async function buildReview(
  appHtml,
  { title, lang = "", revision = "", metadata = {} } = {},
) {
  const external = findExternalAssets(appHtml);
  if (external.length)
    throw new Error(
      "Preview contains external assets:\n" + external.join("\n"),
    );
  const [style, script] = await Promise.all([
    readFile(new URL("./inspector.css", import.meta.url), "utf8"),
    readFile(new URL("./inspector.js", import.meta.url), "utf8"),
  ]);
  const info = {
    ...metadata,
    revision: revision || metadata.revision || "",
    contentHash: createHash("sha256").update(appHtml).digest("hex"),
  };
  const payload = JSON.stringify({
    appHtml,
    title,
    lang,
    metadata: info,
  }).replace(/</g, "\\u003c");
  const version = String(info.revision).replace(/[^0-9a-f]/gi, "");
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; frame-src 'self' about:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'\">" +
    '<meta name="showai-source-revision" content="' +
    version +
    '"><title>UI review</title><style>' +
    style +
    "</style></head><body>" +
    '<div id="review-root"></div><script id="review-app" type="application/json">' +
    payload +
    "</script><script>" +
    script.replace(/<\/script/gi, "<\\/script") +
    "</script></body></html>\n"
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [input, output, ...options] = process.argv.slice(2);
  if (!input || !output || resolve(input) === resolve(output))
    throw new Error(
      "Usage: node pack.mjs <app.html> <preview.html> [--source <checkout>] [--title <title>] [--data <description>]",
    );
  const values = {};
  for (let index = 0; index < options.length; index += 2) {
    const flag = options[index];
    if (
      !["--source", "--title", "--data", "--lang"].includes(flag) ||
      !options[index + 1]
    )
      throw new Error("Invalid option: " + flag);
    values[flag] = options[index + 1];
  }
  const metadata = {
    ...sourceMetadata(resolve(values["--source"] || process.cwd())),
    generatedAt: new Date().toISOString(),
    dataSource: values["--data"] || "",
  };
  const html = await buildReview(await readFile(input, "utf8"), {
    title: values["--title"],
    lang: values["--lang"],
    metadata,
  });
  const temporary = resolve(output) + "." + process.pid + ".tmp";
  await writeFile(temporary, html);
  await rename(temporary, resolve(output));
}

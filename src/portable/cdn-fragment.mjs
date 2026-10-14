import { randomUUID } from "node:crypto";
import { CAPACITY, CapacityError } from "./capacity.mjs";
import { assertInlineArtifact } from "./inline.mjs";
import { publicationUrl } from "./remote.mjs";

/** Reader entry URLs in the order the loader tries them. */
function readerSources({ readerUrl, readerUrls }) {
  const urls = (readerUrls ?? [readerUrl]).map((value) =>
    publicationUrl(value),
  );
  if (!urls.length || urls.length > 8)
    throw new Error("Provide one to eight reader URLs.");
  for (const url of urls)
    if (!/\.m?js$/.test(new URL(url).pathname))
      throw new Error(
        "The reader URL must point to the reader's entry module.",
      );
  return urls;
}

/** Reads the page and language from a page built by injectArtifactIntoHtml. */
function pageData(html) {
  const source = html.match(
    /<script\b[^>]*\bid=["']showai-data["'][^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  if (!source || source.trim() === "null")
    throw new Error("The page has no ShowAI data to display.");
  const artifact = JSON.parse(source);
  const lang = html.match(/<html\b[^>]*\slang=["']([\w-]+)["']/i)?.[1];
  // The page travels inside the loader, so hosts that drop or rewrite
  // data-only script elements still receive it. Escaping "<" keeps it inert
  // inside <script> without changing its values.
  const data = JSON.stringify(artifact)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return { artifact, lang, data };
}

/**
 * A classic script that imports the first reachable reader and mounts the
 * page. Classic scripts with import() run in hosts that accept only classic
 * inline scripts while still loading the reader's ES modules. Each source
 * serves the same build, so its chunks load from wherever the entry did.
 */
function loader(id, data, urls, lang, standalone) {
  const failed = lang?.startsWith("zh")
    ? "无法加载 ShowAI 阅读器："
    : "The ShowAI reader could not load: ";
  return `(async()=>{const root=document.getElementById(${JSON.stringify(id)});const artifact=${data};let failure;for(const url of ${JSON.stringify(urls)}){let reader;try{reader=await import(url)}catch(error){failure=error;continue}reader.mount(root,{artifact${standalone ? ",standalone:true" : ""}});return}root.textContent=${JSON.stringify(failed)}+(failure&&failure.message||failure);})();`;
}

const placeholder = (lang) =>
  `<p data-showai-placeholder style="margin:0;padding:24px 0;color:#888;font:14px/1.5 system-ui,sans-serif">${lang?.startsWith("zh") ? "正在加载 ShowAI 页面…" : "Loading the ShowAI page…"}</p>`;

/**
 * Writes a conversation fragment that carries only the page and imports the
 * reader from a static host. Reader URLs name the entry module of a CDN build
 * (scripts/build-cdn-reader.mjs); pin them to an immutable version.
 */
export function toCdnFragment(
  html,
  { readerUrl, readerUrls, id = `showai-${randomUUID()}` } = {},
) {
  if (!/^showai-[a-z0-9-]+$/.test(id))
    throw new Error("Invalid inline page id.");
  const urls = readerSources({ readerUrl, readerUrls });
  const { artifact, lang, data } = pageData(html);
  assertInlineArtifact(artifact);
  const fragment = `<section id="${id}" data-showai-inline-root${lang ? ` lang="${lang}"` : ""}>${placeholder(lang)}</section>
<script>${loader(id, data, urls, lang, false)}</script>
`;
  if (Buffer.byteLength(fragment) > CAPACITY.chatBytes)
    throw new CapacityError(
      "CDN chat preview",
      Buffer.byteLength(fragment),
      CAPACITY.chatBytes,
    );
  return fragment;
}

/**
 * Writes a complete HTML page that loads the reader from a static host. Page
 * data, custom components and embedded images stay in the file; the reader
 * and built-in components come from the CDN, so opening it needs network.
 */
export function toCdnPage(
  html,
  { readerUrl, readerUrls, id = `showai-${randomUUID()}` } = {},
) {
  if (!/^showai-[a-z0-9-]+$/.test(id)) throw new Error("Invalid page id.");
  const urls = readerSources({ readerUrl, readerUrls });
  const { lang, data } = pageData(html);
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "ShowAI";
  return `<!doctype html>
<html lang="${lang ?? "zh-CN"}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="generator" content="ShowAI online page">
</head>
<body>
<div id="${id}">${placeholder(lang)}</div>
<script>${loader(id, data, urls, lang, true)}</script>
</body>
</html>
`;
}

import { encodeBinaryText, decodeBinaryText } from "./binary-text.mjs";
import { packedArtifact, restoreArtifact } from "./artifact-transport.mjs";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { CAPACITY, CapacityError } from "./capacity.mjs";
import { assertInlineArtifact } from "./inline.mjs";
import { publicationUrl } from "./remote.mjs";

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

function pageData(html) {
  const source = html.match(
    /<script\b[^>]*\bid=["']showai-data["'][^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  if (!source || source.trim() === "null")
    throw new Error("The page has no ShowAI data to display.");
  const artifact = JSON.parse(source);
  const lang = html.match(/<html\b[^>]*\slang=["']([\w-]+)["']/i)?.[1];
  const data = JSON.stringify(artifact)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return { artifact, lang, data };
}

function loader(id, data, urls, lang, standalone) {
  const failed = lang?.startsWith("zh")
    ? "无法加载 ShowAI 阅读器："
    : "The ShowAI reader could not load: ";
  const timeout = lang?.startsWith("zh")
    ? "加载超过 15 秒，请重试或打开完整离线页面。"
    : "Loading exceeded 15 seconds. Retry or open the complete offline page.";
  return `(async()=>{const root=document.getElementById(${JSON.stringify(id)});const timers=[];const wait=(ms,start)=>new Promise((resolve,reject)=>{timers.push(setTimeout(()=>Promise.resolve().then(start).then(resolve,reject),ms))});try{const artifact=${data};const starts=[];const readers=${JSON.stringify(urls)}.map((url,index)=>new Promise((resolve,reject)=>{const start=starts[index]=()=>{if(start.done)return;start.done=true;import(url).then(resolve,error=>{reject(error);starts[index+1]?.()})};if(index)timers.push(setTimeout(start,index*1500))}));starts[0]();const reader=await Promise.race([Promise.any(readers),wait(15000,()=>{throw new Error(${JSON.stringify(timeout)})})]);reader.mount(root,{artifact${standalone ? ",standalone:true" : ""}});}catch(error){const reason=error instanceof AggregateError?error.errors.map(e=>e&&e.message||String(e)).join("; "):error&&error.message||String(error);root.textContent=${JSON.stringify(failed)}+reason;}finally{timers.forEach(clearTimeout)}})();`;
}

const placeholder = (lang) =>
  `<p data-showai-placeholder style="margin:0;padding:24px 0;color:#888;font:14px/1.5 system-ui,sans-serif">${lang?.startsWith("zh") ? "正在加载 ShowAI 页面…" : "Loading the ShowAI page…"}</p>`;

export function toCdnFragment(
  html,
  { readerUrl, readerUrls, id = `showai-${randomUUID()}` } = {},
) {
  if (!/^showai-[a-z0-9-]+$/.test(id))
    throw new Error("Invalid inline page id.");
  const urls = readerSources({ readerUrl, readerUrls });
  const { artifact, lang, data } = pageData(html);
  assertInlineArtifact(artifact);
  const render = (
    value,
  ) => `<section id="${id}" data-showai-inline-root${lang ? ` lang="${lang}"` : ""}>${placeholder(lang)}</section>
<script>${loader(id, value, urls, lang, false)}</script>
`;
  let fragment = render(data);
  if (Buffer.byteLength(fragment) >= 128_000) {
    const bytes = gzipSync(JSON.stringify(packedArtifact(artifact)), {
      level: 9,
    });
    const compact = bytes.length > 650000;
    const packed = compact ? encodeBinaryText(bytes) : bytes.toString("base64");
    const expression = `await(async()=>{const bundle=JSON.parse(await new Response(new Blob([${compact ? `(${decodeBinaryText.toString()})(${JSON.stringify(packed)})` : `Uint8Array.from(atob(${JSON.stringify(packed)}),c=>c.charCodeAt(0))`}]).stream().pipeThrough(new DecompressionStream("gzip"))).text());return (${restoreArtifact.toString()})(bundle);})()`;
    const compressed = render(expression);
    if (Buffer.byteLength(compressed) < Buffer.byteLength(fragment))
      fragment = compressed;
  }
  if (Buffer.byteLength(fragment) > CAPACITY.chatBytes)
    throw new CapacityError(
      "CDN chat preview",
      Buffer.byteLength(fragment),
      CAPACITY.chatBytes,
    );
  return fragment;
}

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

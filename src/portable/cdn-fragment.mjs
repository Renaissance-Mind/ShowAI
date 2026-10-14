import { randomUUID } from "node:crypto";
import { CAPACITY, CapacityError } from "./capacity.mjs";
import { assertInlineArtifact } from "./inline.mjs";
import { publicationUrl } from "./remote.mjs";

/**
 * Writes a conversation fragment that carries only the page and imports the
 * reader from a static host. `readerUrl` is the reader entry module of a CDN
 * build (scripts/build-cdn-reader.mjs); pin it to an immutable version.
 */
export function toCdnFragment(
  html,
  { readerUrl, id = `showai-${randomUUID()}` } = {},
) {
  if (!/^showai-[a-z0-9-]+$/.test(id))
    throw new Error("Invalid inline page id.");
  const url = publicationUrl(readerUrl);
  if (!/\.m?js$/.test(new URL(url).pathname))
    throw new Error("The reader URL must point to the reader's entry module.");
  const source = html.match(
    /<script\b[^>]*\bid=["']showai-data["'][^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  if (!source || source.trim() === "null")
    throw new Error("The page has no ShowAI data to display.");
  const artifact = JSON.parse(source);
  assertInlineArtifact(artifact);
  const lang = html.match(/<html\b[^>]*\slang=["']([\w-]+)["']/i)?.[1];
  // The page travels inside the loader, so hosts that drop or rewrite
  // data-only script elements still receive it. Escaping "<" keeps it inert
  // inside <script> without changing its values.
  const data = JSON.stringify(artifact)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const failed = lang?.startsWith("zh")
    ? "无法加载 ShowAI 阅读器："
    : "The ShowAI reader could not load: ";
  // A classic script with import() runs in hosts that only accept classic
  // inline scripts while still loading the reader's ES modules.
  const loader = `(()=>{const root=document.getElementById(${JSON.stringify(id)});const artifact=${data};import(${JSON.stringify(url)}).then((reader)=>reader.mount(root,{artifact})).catch((error)=>{root.textContent=${JSON.stringify(failed)}+(error&&error.message||error);});})();`;
  const fragment = `<section id="${id}" data-showai-inline-root${lang ? ` lang="${lang}"` : ""}><p data-showai-placeholder style="margin:0;padding:24px 0;color:#888;font:14px/1.5 system-ui,sans-serif">${lang?.startsWith("zh") ? "正在加载 ShowAI 页面…" : "Loading the ShowAI page…"}</p></section>
<script>${loader}</script>
`;
  if (Buffer.byteLength(fragment) > CAPACITY.chatBytes)
    throw new CapacityError(
      "CDN chat preview",
      Buffer.byteLength(fragment),
      CAPACITY.chatBytes,
    );
  return fragment;
}

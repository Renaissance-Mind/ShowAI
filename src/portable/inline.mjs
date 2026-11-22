import { encodeBinaryText, decodeBinaryText } from "./binary-text.mjs";
import { packedArtifact, restoreArtifact } from "./artifact-transport.mjs";
import { CAPACITY, CapacityError } from "./capacity.mjs";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { inlineStyleSheet, scopeReaderCss } from "./inline-style.mjs";
import { walk } from "../document/walk.mjs";

export function assertInlineArtifact(artifact) {
  if (artifact?.remoteComponents?.length)
    throw new Error(
      "Inline conversation pages must bundle all components; the host blocks remote component requests.",
    );
  const references = new Map();
  if (artifact?.document?.content)
    walk(artifact.document.content, (node) => {
      if ((node.type === "widget" || node.type === "inlineWidget") && node.attrs?.kind === "custom") {
        const data = node.attrs.data;
        references.set(
          `${data?.componentId}@${data?.version}#${data?.integrity ?? data?.scope ?? "legacy"}`,
          data,
        );
      }
    }, { scope: "content" });
  for (const [reference, ref] of references) {
    const candidates = artifact.components?.filter(
      (item) =>
        item.id === ref.componentId &&
        item.version === ref.version &&
        (ref.integrity
          ? item.integrity === ref.integrity
          : !ref.scope || item.scope === ref.scope),
    );
    const component = candidates?.length === 1 ? candidates[0] : undefined;
    if (!component?.inline?.script)
      throw new Error(
        `Custom component ${reference} needs an inline runtime. Import its rebuilt source as a new version, or export standalone HTML.`,
      );
    if (
      component.inline.protocol !== undefined &&
      component.inline.protocol !== 1
    )
      throw new Error(
        `Custom component ${reference} requires inline protocol ${component.inline.protocol}; this reader supports protocol 1 and legacy packages.`,
      );
  }
}

export function toInlineFragment(html, id = `showai-${randomUUID()}`, host) {
  if (!/^showai-[a-z0-9-]+$/.test(id))
    throw new Error("Invalid inline page id.");
  const body = html
    .slice(html.lastIndexOf("</head>") + 7)
    .match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  const lang = html.match(/<html\b[^>]*\slang=["']([\w-]+)["']/i)?.[1];
  const langAttribute = lang ? ` lang="${lang}"` : "";
  const styles = [
    ...html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi),
  ].map((match) => match[1]);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const artifactSource = scripts.find(
    (match) =>
      match[1].includes("application/json") &&
      /\bid=["']showai-data["']/.test(match[1]),
  );
  if (artifactSource) assertInlineArtifact(JSON.parse(artifactSource[2]));
  if (
    !body ||
    !styles.length ||
    !scripts.some((match) => match[1].includes("module"))
  )
    throw new Error("A built ShowAI reader is required.");
  const mountId = `${id}-root`;
  const dataId = `${id}-data`;
  const markup = body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace('id="root"', `id="${mountId}"`);
  if (!markup.includes(`id="${mountId}"`))
    throw new Error("The reader mount point is missing.");
  const css = scopeReaderCss(styles.join("\n"));
  const code = scripts
    .map(([, attributes, source]) => {
      if (attributes.includes("application/json"))
        return `<script type="application/json" id="${dataId}">${source}</script>`;
      const script = source
        .replace(
          /getElementById\((["'`])root\1\)/g,
          `getElementById("${mountId}")`,
        )
        .replace(
          /getElementById\((["'`])showai-data\1\)/g,
          `getElementById("${dataId}")`,
        )
        .replaceAll(
          "window.document.documentElement.dataset.theme",
          `window.document.getElementById("${id}").dataset.theme`,
        )
        .replace(/<(?=!doctype\b|(?:html|head|body)(?:\s|>))/gi, "\\x3c");
      return `<script type="module">${script}</script>`;
    })
    .join("\n");
  let sheet = inlineStyleSheet(id, css);
  if (host === "t3-html") {
    // T3 sizes the frame from its content. Dialogs can use the device's screen height.
    sheet = sheet.replace(/(?<![\w.+/])(-?(?:\d+(?:\.\d+)?|\.\d+))[sld]?vh\b/gi,
      (_, value) => `calc(var(--showai-screen-unit, 6.4px) * ${value})`);
  }
  let fragment = `<section id="${id}" data-showai-inline-root${langAttribute}>${markup}</section>
<style>
${sheet}
</style>
${code}
`;
  // The native preview measures after the first paints. Load the bundled modules with the document.
  if (host === "t3-html") return fragment;
  if (Buffer.byteLength(fragment) >= 128_000) {
    const buildTransport = (inlineOnly) => {
      const packedData = artifactSource
        ? packedArtifact(JSON.parse(artifactSource[2]), { inlineOnly })
        : { artifact: null, html: [] };
      const transport = {
        artifact: packedData.artifact?.components?.length
          ? JSON.stringify(packedData.artifact)
          : (artifactSource?.[2] ?? "null"),
        html: packedData.html,
        css: fragment.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "",
        modules: [
          ...code.matchAll(/<script type="module">([\s\S]*?)<\/script>/g),
        ].map((match) => match[1]),
      };
      const bytes = gzipSync(JSON.stringify(transport), { level: 9 });
      const compactEncoding = bytes.length > 650000;
      const packed = compactEncoding
        ? encodeBinaryText(bytes)
        : bytes.toString("base64");
      const packedId = `${id}-packed`;
      const bootstrap = `const packed=JSON.parse(document.getElementById("${packedId}").textContent);const bytes=packed.encoding==='gzip-base91'?(${decodeBinaryText.toString()})(packed.data):Uint8Array.from(atob(packed.data),c=>c.charCodeAt(0));const bundle=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text());const root=document.getElementById("${id}");const style=document.createElement("style");style.textContent=bundle.css;root.append(style);const artifact=(${restoreArtifact.toString()})({artifact:JSON.parse(bundle.artifact),html:bundle.html});document.getElementById("${dataId}").textContent=JSON.stringify(artifact);for(const code of bundle.modules){await new Promise((resolve,reject)=>{const script=document.createElement("script");script.type="module";script.textContent=code;script.onload=resolve;script.onerror=()=>reject(new Error("ShowAI inline reader could not start."));root.append(script);});}`;
      const compressed = `<section id="${id}" data-showai-inline-root${langAttribute}>${markup}</section>\n<script type="application/json" id="${dataId}">null</script>\n<script type="application/json" id="${packedId}" data-showai-packed-data="gzip">${JSON.stringify({ encoding: compactEncoding ? "gzip-base91" : "gzip", data: packed })}</script>\n<script type="module" data-showai-packed-reader="gzip">${bootstrap}</script>\n`;
      return compressed;
    };
    let compressed = buildTransport(false);
    if (Buffer.byteLength(compressed) > CAPACITY.chatBytes)
      compressed = buildTransport(true);
    if (Buffer.byteLength(compressed) < Buffer.byteLength(fragment))
      fragment = compressed;
  }
  if (Buffer.byteLength(fragment) > CAPACITY.chatBytes)
    throw new CapacityError(
      "Compressed chat preview",
      Buffer.byteLength(fragment),
      CAPACITY.chatBytes,
    );
  return fragment;
}

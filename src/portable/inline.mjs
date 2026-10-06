import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";

/** Adapt our self-contained reader to the conversation's isolated HTML surface. */
export function toInlineFragment(html, id = `showai-${randomUUID()}`) {
  if (!/^showai-[a-z0-9-]+$/.test(id))
    throw new Error("Invalid inline page id.");
  const body = html
    .slice(html.lastIndexOf("</head>") + 7)
    .match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(
    (match) => match[1],
  );
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const artifactSource = scripts.find(
    (match) =>
      match[1].includes("application/json") &&
      /\bid=["']showai-data["']/.test(match[1]),
  );
  if (artifactSource) {
    const artifact = JSON.parse(artifactSource[2]);
    if (artifact?.remoteComponents?.length)
      throw new Error(
        "Inline conversation pages must bundle all components; the host blocks remote component requests.",
      );
    const references = new Map();
    const visit = (node) => {
      if (node?.type === "widget" && node.attrs?.kind === "custom") {
        const data = node.attrs.data;
        references.set(
          `${data?.componentId}@${data?.version}#${data?.integrity ?? data?.scope ?? "legacy"}`,
          data,
        );
      }
      node?.content?.forEach(visit);
    };
    visit(artifact?.document?.content);
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
    }
  }
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
  const css = styles
    .join("\n")
    .replace(/@charset[^;]+;/g, "")
    .replaceAll(":root", ":scope")
    .replace(/(?<![\w-])(?:html|body)(?=[,{])/g, ":scope");
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
        // Preserve DOMParser's runtime string while keeping the serialized file fragment-only.
        .replace(/<(?=!doctype\b|(?:html|head|body)(?:\s|>))/gi, "\\x3c");
      return `<script type="module">${script}</script>`;
    })
    .join("\n");
  let fragment = `<section id="${id}" data-showai-inline-root>${markup}</section>\n<style>\n@scope (#${id}) {\n${css}\n.portable-document { max-width: none; padding: 24px 0 12px; }\n.portable-title { padding-right: 96px; font-size: 28px; margin-bottom: 24px; }\n.portable-options { display: none; }\n.portable-app { min-height: 0; }\n}\n</style>\n${code}\n`;
  // Keep the editable artifact as plain JSON; pack only our generated reader.
  // The bootstrap restores a normal inline module without eval, URLs or network.
  if (Buffer.byteLength(fragment) > 1_000_000) {
    fragment = fragment.replace(
      /<script type="module">([\s\S]*?)<\/script>/g,
      (_tag, script) => {
        const packed = gzipSync(script, { level: 9 }).toString("base64");
        const bootstrap = `const bytes=Uint8Array.from(atob("${packed}"),c=>c.charCodeAt(0));const reader=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();const script=document.createElement("script");script.type="module";script.textContent=reader;document.getElementById("${id}").append(script);`;
        return `<script type="module" data-showai-packed-reader="gzip">${bootstrap}</script>`;
      },
    );
  }
  if (Buffer.byteLength(fragment) > 1_000_000)
    throw new Error(
      "The inline page exceeds the 1 MB conversation limit. Use a standalone HTML page instead.",
    );
  return fragment;
}

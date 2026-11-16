export function packedArtifact(artifact, { inlineOnly = false } = {}) {
  if (!artifact || typeof artifact !== "object") return { artifact, html: [] };
  const copy = {
    ...artifact,
    ...(artifact.components
      ? {
          components: artifact.components.map((component) => ({
            ...component,
          })),
        }
      : {}),
  };
  const html = [];
  for (
    let index = 0;
    index < Math.min(copy.components?.length ?? 0, 16);
    index++
  ) {
    const component = copy.components[index];
    const inline = component.inline;
    if (!inline || typeof component.html !== "string") continue;
    if (inlineOnly) {
      component.html = "<!--SHOWAI_COMPONENT_DATA-->";
      component.presentationOnly = "inline";
      continue;
    }
    const matches = [];
    const styleAt = inline.styles ? component.html.indexOf(inline.styles) : -1;
    if (styleAt >= 0)
      matches.push({
        at: styleAt,
        field: "styles",
        start: 0,
        length: inline.styles.length,
      });
    if (component.html.length <= 4_000_000)
      for (
        let start = 0;
        start + 1024 <= Math.min(inline.script.length, 1_000_000);
        start += 1024
      ) {
        const at = component.html.indexOf(
          inline.script.slice(start, start + 1024),
        );
        if (at >= 0) matches.push({ at, field: "script", start, length: 1024 });
      }
    if (!matches.length) continue;
    matches.sort((a, b) => a.at - b.at);
    const parts = [];
    let cursor = 0;
    for (const match of matches) {
      if (match.at < cursor) continue;
      if (match.at > cursor) parts.push(component.html.slice(cursor, match.at));
      parts.push([match.field, match.start, match.length]);
      cursor = match.at + match.length;
    }
    if (cursor < component.html.length)
      parts.push(component.html.slice(cursor));
    html.push({ index, parts });
    component.html = "";
  }
  return { artifact: copy, html };
}
export function restoreArtifact(bundle) {
  for (const item of bundle.html ?? []) {
    const component = bundle.artifact.components[item.index];
    component.html = item.parts
      .map((part) =>
        typeof part === "string"
          ? part
          : component.inline[part[0]].slice(part[1], part[1] + part[2]),
      )
      .join("");
  }
  return bundle.artifact;
}

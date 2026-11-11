/** The page source embedded by an HTML export (`showai-data` or a `showai-*-data` script). */
export function htmlArtifactSource(html: string): string {
  const scripts = html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
  let fallback = "";
  for (const [, attributes, body] of scripts) {
    const id = /\bid\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1];
    if (id === "showai-data") return body;
    if (!fallback && id && /^showai-.+-data$/.test(id)) fallback = body;
  }
  return fallback;
}

import type { Tokens } from "marked";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

/** Match the Markdown component's code text without adding a serializer newline. */
export function renderMarkdownCode({ text, lang }: Tokens.Code): string {
  const language = lang?.trim().split(/\s+/)[0];
  const attribute = language ? ` class="language-${escapeHtml(language)}"` : "";
  return `<pre><code${attribute}>${escapeHtml(text)}</code></pre>\n`;
}

export function scopeReaderCss(css) {
  return css
    .replace(/@charset[^;]+;/g, "")
    .replaceAll(":root", ":scope")
    .replace(/(?<![\w-])(?:html|body)(?=[,{])/g, ":scope");
}

export const INLINE_READER_OVERRIDES = `.portable-document { max-width: none; padding: 24px 0 12px; }
.portable-page-heading,
.container-page-heading:empty,
.container-page-heading:has(> .portable-page-heading:only-child) { display: none; }
.portable-options { display: none; }
.portable-app { min-height: 0; }
.portable-app:has(> .container-workspace > .container-main > .container-page.is-root),
.portable-app:has(> .container-workspace > .container-main > .page-outline-shell:not([data-outline-docked]) > .container-page.is-root),
.portable-app > .container-workspace:has(> .container-main > .container-page.is-root),
.portable-app > .container-workspace:has(> .container-main > .page-outline-shell:not([data-outline-docked]) > .container-page.is-root),
.portable-app > .container-workspace > .container-main > .page-outline-shell:not([data-outline-docked]):has(> .container-page.is-root) {
  height: auto;
}
.portable-app > .container-workspace > .container-main:has(> .container-page.is-root),
.portable-app > .container-workspace > .container-main:has(> .page-outline-shell:not([data-outline-docked]) > .container-page.is-root) {
  flex: none;
}
.portable-app > .container-workspace > .container-main > .container-page.is-root,
.portable-app > .container-workspace > .container-main > .page-outline-shell:not([data-outline-docked]) > .container-page.is-root {
  height: auto;
  overflow: visible;
  overscroll-behavior: auto;
  scrollbar-gutter: auto;
}`;

export function inlineStyleSheet(id, css) {
  return `@scope (#${id}) {\n${css}\n${INLINE_READER_OVERRIDES}\n}`;
}

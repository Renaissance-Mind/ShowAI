# Application icons

**Language:** English | [简体中文](i18n/icons.zh-CN.md) · [Documentation](README.md)

Open **Settings → Icons** to browse the application icon catalog. Search by English name or Chinese category, compare size, stroke, color and light/dark backgrounds, then copy the name or SVG or download the preview.

## Shared source

`src/ui/icons.ts` is the application's shared Lucide export module. Add named exports there and import application icons through it. The browser enumerates that module directly; development saves and release builds update it. A named alias can preserve a caller's existing import when an icon changes.

Preview settings affect the browser and exported SVG. `src/studio/IconViewer.tsx` defines categories. `src/ui/icons.test.ts` checks imports and verifies SVG rendering. Built-in component compilation embeds the same icon source in the SDK virtual files through `src/core/builtin-sources.ts`.

Menus pair icons with labels. Compact icon controls need accessible names; hover help should remain useful without duplicating a visible label. Content visuals, icons inside custom components and data options are outside the application icon catalog.

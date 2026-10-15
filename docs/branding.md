# Brand assets

**Language:** English | [简体中文](i18n/branding.zh-CN.md) · [Documentation](README.md)

The ShowAI mark consists of three offset rounded rectangles with `#06A5FA` in the center. Its 512 × 512 design uses inner radius 37, horizontal offset 75, vertical offset 60 and layer spacing 16.

`src/desktop/assets/icon-design.json` stores the design parameters; `apple-icon-mask.json` stores the display outline. Application and plugin assets derive from this source.

| Asset in `src/desktop/assets/`                        | Use                                 |
| ----------------------------------------------------- | ----------------------------------- |
| `icon.svg`, `icon.png`, `icon.icns`                   | Dark background, white side layers  |
| `icon-light.svg`, `icon-light.png`, `icon-light.icns` | Light background, black side layers |
| `icon-unmasked.svg`, `icon-unmasked.png`              | Full square dark master             |
| `icon-light-unmasked.svg`, `icon-light-unmasked.png`  | Full square light master            |

SVG masters are vector assets; PNG masters are opaque 1024 × 1024 images. Use the unmasked square master when applying a platform-specific icon mask. See [Apple's app icon guidance](https://developer.apple.com/design/human-interface-guidelines/app-icons).

Regenerate application assets from the repository root:

```sh
node src/desktop/assets/generate-icons.mjs
```

README artwork lives in `docs/showai-banner.svg`, `docs/showai-audience.svg` and `docs/showai-design-logic.svg`, with Chinese variants in `docs/i18n/`. Keep both language variants synchronized when changing their content.

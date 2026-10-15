# 品牌资源

**语言：** [English](../branding.md) | 简体中文 · [文档目录](index.zh-CN.md)

ShowAI 标识由三张错位的圆角矩形组成，中间使用 `#06A5FA`。512 × 512 设计画布中的内部圆角为 37、横向错位为 75、纵向错位为 60，层间留白为 16。

`src/desktop/assets/icon-design.json` 保存设计参数，`apple-icon-mask.json` 保存显示轮廓。应用与插件图标由这些源资源生成。

| `src/desktop/assets/` 中的资源                        | 用途               |
| ----------------------------------------------------- | ------------------ |
| `icon.svg`、`icon.png`、`icon.icns`                   | 深色底、白色两侧   |
| `icon-light.svg`、`icon-light.png`、`icon-light.icns` | 浅色底、黑色两侧   |
| `icon-unmasked.svg`、`icon-unmasked.png`              | 深色完整正方形母版 |
| `icon-light-unmasked.svg`、`icon-light-unmasked.png`  | 浅色完整正方形母版 |

SVG 母版是矢量；PNG 母版为不透明的 1024 × 1024 图像。制作其他平台图标时，从完整正方形母版应用相应遮罩。参见 [Apple 应用图标规范](https://developer.apple.com/design/human-interface-guidelines/app-icons)。

在仓库根目录重新生成：

```sh
node src/desktop/assets/generate-icons.mjs
```

README 图示位于 `docs/showai-banner.svg`、`docs/showai-audience.svg` 和 `docs/showai-design-logic.svg`，中文图示位于 `docs/i18n/`。修改图示内容时同步更新两种语言。

# ShowAI 图标资产

定稿图标为三张错位的圆角矩形，中间使用 `#06A5FA`。内部圆角半径为 37，横向错位为 75，纵向错位为 60，层间留白为 16；坐标基于 512 × 512 画布。

`src/desktop/assets/icon-design.json` 保存**定稿参数**，`apple-icon-mask.json` 保存从 Apple Icon Composer 默认遮罩取得的显示轮廓。应用、插件、banner、设计说明图和介绍 PPT 从**同一组图标资产**生成。

| 资产 | 用途 |
| --- | --- |
| `icon.svg`、`icon.png`、`icon.icns` | 黑底、白色两侧，用于亮色界面的图标。 |
| `icon-light.svg`、`icon-light.png`、`icon-light.icns` | 白底、黑色两侧，用于暗色界面的图标。 |
| `icon-unmasked.svg`、`icon-unmasked.png` | 黑底的完整正方形母版。 |
| `icon-light-unmasked.svg`、`icon-light-unmasked.png` | 白底的完整正方形母版。 |

无外框遮罩的母版保留完整背景和内部矩形的圆角；SVG 为矢量，PNG 为 1024 × 1024 的不透明图像。为其他平台制作图标时，从母版应用该平台的遮罩。[Apple 图标规范](https://developer.apple.com/design/human-interface-guidelines/app-icons)要求提供**未遮罩的正方形图层**，由系统生成最终外轮廓。

在仓库根目录重新生成应用图标与母版：

```sh
node src/desktop/assets/generate-icons.mjs
```

`design/banner/build.py` 和 `design/logic/build.py` 读取应用 SVG，`design/svg_logo.py` 保留路径与矩形，并将描边顺序转换为可编辑图层。介绍 PPT 读取同一组参数和遮罩，构建原生矢量对象；独立制作源中的 `assets` 保存对应参数副本。

`design/icons/information-funnel/` 与 `design/icons/icon-composer/` 记录定稿前的设计方案。当前应用与文档的生成入口使用上表中的**定稿资产**。

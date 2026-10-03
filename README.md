# ShowAI

一份可以探索的文档。

ShowAI 是一个本地优先的 React 文档画布，为 Codex 调研结果提供可阅读、可交互、可继续编辑的承载方式。文字、图片、图表、数据库和参数控件都以区块组织，完整文档可以导出为独立 HTML。

![ShowAI 文档工作区](docs/showai.png)

## 启动

使用 Node.js 22.12+ 和 npm。

```bash
npm ci
npm run build
npm run dev
```

打开终端显示的本地地址，默认是 `http://127.0.0.1:5173`。构建步骤也会生成 HTML 导出所需的离线阅读器。后续开发只需 `npm run dev`；修改阅读器或区块后重新构建，更新导出模板。

## 文档空间

- 富文本编辑、Markdown 输入快捷键、斜杠菜单、选中文字后的浮动工具栏。
- 标题、段落、列表、待办、引用、代码、分隔线、图片、表格、提示块和折叠块。
- 区块拖动、上移下移、复制、删除，编辑撤销与重做。
- 嵌套页面、收藏、全文搜索、模板、页面复制、移动和回收站恢复。
- 自动保存、页面批注、版本快照、目录、阅读模式、字体与深色外观。
- JSON 文档、Markdown 导入导出，工作区备份与合并导入，打印为 PDF。

`⌘ / Ctrl + K` 搜索，`⌘ / Ctrl + S` 保存版本快照，`/` 插入区块。页面切换也会保存快照，每页保留最近 15 个版本。

## 交互区块

| 区块     | 能力                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| 图表     | SVG 折线图与柱状图、系列开关、数值提示、数据编辑、CSV 导出                           |
| 数据库   | 文本、数字、单选、复选框、链接字段，增删记录与属性、搜索、排序、筛选、分页、看板分组 |
| 指标     | 多个指标、单位、说明与变化值                                                         |
| 参数控件 | 滑块输入、求和、乘积、平均值，实时更新结果                                           |
| 来源卡片 | 标题、来源链接、说明和出处信息                                                       |
| 图片集   | 图片展示与说明，保留可访问的替代文本                                                 |

内置欢迎文档中的图表使用 `y = x` 和 `y = x²`，计算器使用分钟数乘以天数。这些是交互教学示例。

## 给 Codex 使用

仓库提供一个可打包的 skill 插件，生成有出处的结构化文档，再通过本地命令打包成 HTML。插件无需 API Key，也不运行后端服务。

```bash
npm run build
node scripts/render-artifact.mjs examples/welcome.showai.json artifacts/welcome.html
```

生成的 HTML 包含 React 阅读器、样式、区块数据和内嵌图片，可以直接打开。图表开关、数据库筛选、折叠区块和参数控件仍可交互；“下载源文件”可取出 JSON，再导入 ShowAI 编辑。

完整插件位于 `plugins/showai`，仓库级插件目录配置位于 `.agents/plugins/marketplace.json`。构建负责打包；安装通过 Codex 的插件界面完成。参见[插件说明](plugins/showai/README.md)和[文档格式](docs/artifact-format.md)。

## 注册自己的 block

区块通过注册表接入编辑器与 HTML 阅读器。新增组件后，在应用入口加载注册代码，并重新构建；需要离线交付的组件，也要在阅读器入口加载注册代码。

```tsx
import { registerBlock } from "./src/components/blocks/registry";

registerBlock({
  kind: "my-block",
  title: "我的区块",
  description: "一个自定义交互区块",
  icon: "✦",
  defaultData: { message: "Hello" },
  renderer: ({ data }) => <div>{String(data.message)}</div>,
});
```

文档中只保存 `{ type: 'widget', attrs: { kind: 'my-block', data: {...} } }`。组件实现随应用发布，未知区块会保留数据并显示说明。文档数据不执行任意 JavaScript。

## 数据与运行边界

每个工作区最多保存 1000 个页面。数据保存在当前浏览器的本地存储，容量取决于浏览器。保存失败会显示提示；请定期导出工作区备份。浏览器清理站点数据会移除本地文档。当前版本提供单人本地工作区，多人同步、账号、云端权限和跨数据库关联需要后端支持。

HTML 阅读版本支持临时交互；编辑源文件用于持久修改。外链仍需联网访问，离线图片必须内嵌。具体大小限制和图片打包策略见[文档格式](docs/artifact-format.md)。

## 开发与验证

```bash
npm test
npm run check
npm run build
npm run preview
```

应用使用 React、Tiptap/ProseMirror、TypeScript 和 Vite。图表为 SVG 组件，没有额外图表库、后端服务或运行时 CDN 依赖。阅读器打包成单文件，编辑器按正常静态网站构建。

源码分为 `src/editor`（编辑器）、`src/components/blocks`（区块注册与交互）、`src/lib`（工作区与导入导出）、`src/portable`（阅读器与格式校验），以及 `plugins/showai`（Codex 插件）。

发布许可证尚未指定。

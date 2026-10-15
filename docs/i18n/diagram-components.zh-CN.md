# 图形组件

**语言：** [English](../diagram-components.md) | 简体中文 · [文档目录](index.zh-CN.md)

Flow 类别包括三组图形组件，可从 Page/Board 的 `/` 菜单插入，或通过 component.insert 使用内置 kind。

| kind                 | 内置类型                                                                                | 原项目                                                                         |
| -------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| archify              | 10 类：工作流、架构、时序、数据流、生命周期、实体关系、类与接口、树形、时间线、瀑布追踪 | [Archify](https://github.com/tt-a1i/archify)                                   |
| diagram-design       | 45 种编辑图形                                                                           | [Diagram Design](https://github.com/cathrynlavery/diagram-design)              |
| fireworks-tech-graph | 12 种技术图形风格                                                                       | [Fireworks Tech Graph](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) |

组件显示原始 SVG/HTML。Archify 保留搜索、路径探索、预设和导出；Diagram Design 保留版式/CSS；Fireworks 保留 SVG 几何与语义连接。示例是可编辑起点，正式内容应使用实际事实。

## 输入、编辑与展示

template 选择内置示例；source 可用完整 SVG 或含 SVG 的 HTML 替换，导入自有图时使用 template:custom。title/description 是外部说明；height 范围 240–1200，默认 560 像素。

选中组件，使用现有设置菜单选择模板、编辑 SVG 文字、导入 SVG/HTML 或修改完整源码。文字修改不自动重排几何，较长标签可能需要改布局。保存核对起始版本并保留并发修改的草稿。

新实例默认紧凑展示：标题/副标题在外部，补充说明折叠。presentation 保存标题内外位置/隐藏、说明折叠、图例与阅读控件显示选项。旧实例省略该字段时显示完整原始内容。选 Original 恢复完整图形，源数据保持不变。自有图需要可识别的标题/图例标记才能使用这些控制。

Agent 先读 guide 与参数，再通过 source view 的 diagram-templates.json 获取完整图形、上游路径、固定提交、许可证和绘制参考。派生组件可从 showai:components 导入 Archify、DiagramDesign、FireworksTechGraph，使用相同离线实现。

## 原始制作流程

guide 的 Original authoring guides 提供上游完整流程、图元、视觉布局规则与检查。每份记录原路径、提交、URL 和 SHA-256；派生包保存并校验这些来源。

按 authoringReference 读取 authoring/index.json，再读取所选源文件；authoring/schemas.json、authoring/examples.json 与 diagram-templates.json 提供输入/示例。工具包保留固定上游版本的完整制作源与资源。

一起提取 authoring/kit.json、run.mjs、diagram-authoring-fonts.mjs 和 font-licenses.json，在新的工作目录按索引运行。Archify 十种 JSON 类型调用原 Node 渲染器；Fireworks 十一种生成风格调用原 Python 生成器。输出另存，保留输入并返回可用于组件的 data。

Diagram Design 和 Fireworks 第八种风格按原指南直接创作 SVG/HTML 后导入。相同源保证相同几何，自由绘制不保证一致。与上游比较时使用 Original。--embed-fonts 下载公开字体并嵌入本机所用字形，字体请求不发送文档文字；Diagram Design 内置示例已带离线字体。

## 阅读与导出

初始阅读锁允许外层滚动与选中，解锁后操作内部阅读器。阅读选项仅改变当前视图。只读页隐藏编辑与导入入口。

SVG 下载保留当前图形和内嵌 CSS；HTML 下载保留阅读器、外部标题与折叠说明。需要全部原始说明时先选择 Original。两者保留上游许可证。示例与资源本地内嵌；导入图应内嵌字体、图片、图标，隔离 frame 禁止外部请求。

三个上游项目均为 MIT。固定版本与完整声明见 src/components/blocks/diagrams/licenses.json，包括 Archify 字体声明。

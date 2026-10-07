---
name: show-document
description: 用 ShowAI 创作、修改、展示或导出具体页面、报告和小型网站，或应用已有模板。已有页面可直接展示整页或选区；创作与修改后默认在支持的 Agent 对话中呈现预览。ShowAI 基础用法、连接、项目查找与纯阅读由 use-showai 统一指南处理。
---

ShowAI 将内容组织成可阅读、可探索的页面。工作台与 Agent 使用同一份项目文件；组件负责表达，模板负责内容组织。先明确读者需要理解什么，再选择布局与交互，使用用户材料或可核实的数据。

首次使用 ShowAI 或不清楚内容模型、运行入口与对象归属时，先读取 [统一使用指南](../use-showai/SKILL.md)，按信息缺口取得入口或定位对象。已有可信 CLI、内容库与项目身份时直接复用。下文 `showai` 代表已核实的外部命令前缀。

用户指定的项目或页面归属优先。新建内容未指定项目时，按统一指南用可信宿主目录解析项目；修改或展示已有页面时采用其项目和页面 ID。仅展示已有内容时，读取当前页面后进入导出与对话展示流程。

普通调研、对比或报告默认保存为项目内的一份 Page。用区域、标题、目录、折叠内容和嵌套容器组织章节；章节数量与内容长度由页面布局处理。用户明确要求网站、多份独立文档或多个页面时再拆分资源；完整项目站点导出用于这些任务。后续补充和修改继续使用同一页面，先 `pages list/read` 定位已有内容，保留其身份。

按本次操作读取 CLI 指南，普通创作先使用 `guide authoring`；构造 Page 结构时读取 `guide containers`，区域内部的富文本区块再读 `guide document`。

- `guide workspace`：项目目录定位与显式项目选择。
- `guide reading`：同一 Page 的结构化、图像与 HTML 读取。
- `guide authoring`：读取、差异、编辑和冲突处理。
- `guide containers`：Page/Board 嵌套、外框、视图与旧页迁移。
- `guide catalog`：摘要搜索，再按需查看用途、输入、示例或源码。
- `guide export`：整页或局部组件的 HTML、会话展示和网站。

新资源默认使用版本 3 的 Page 顺序页面，Board 是独立空间容器。两者可以原生嵌套与展开。内容树记录归属，layout 保存父级外框，surfaceViews 保存各层视图。绘画保存在 Board 内。模板保留容器类型，可用于新建或作为模块插入；局部导出包含所选子树及必要祖先。

Page 和 Board 本身也是组件目录条目，可查询 guide、schema 和 examples，用 component.insert 插入。原生容器通过内容、布局和模板定制；保持 surface 结构，不要把它们编码成普通 widget。

先按用途搜索组件或模板摘要，限制结果数；选中后取 `--view guide`，准备填入数据时取 `schema`，需要参考用法时取 `examples`。普通页面创作无需读取组件源码或整个目录。修改已有页面前读取当前版本、查看差异，并保留 hash、revision 和稳定节点 ID。写入版本化内容库时，同时传当前 --base-hash 与 --base-revision；冲突时先比较，再合并或恢复草稿。

读取 Page 默认使用结构化 JSON；正文阅读可选择 Markdown。长页面先用 `--detail outline` 取得组件与区域 ID，再按 `--blocks` 读取局部。配色、布局、遮挡和选中状态等视觉问题使用 image，悬停、拖动、展开和表单行为使用 html。按需要读取 [Page 三种读取视图](references/page-reading.md) 与 `guide reading`。三种视图记录同一页面 hash、组件版本及渲染状态；修改视觉后查看图像，修改交互后实际操作 HTML。正式编辑使用完整页面的当前 hash 与 revision。

已有组件能够表达内容时直接复用。通过调整数据或组合已有组件能实现需求时采用组合；需要可复用的新交互、图形或布局时，进入 [create-component](../create-component/SKILL.md)，完成后回到页面创作。选库失败本身并不意味着必须写组件，先判断普通文本、表格和既有组件的组合是否足够。

Markdown（kind text）支持 `$…$`、`\(…\)` 行内公式和 `$$…$$`、`\[…\]` 行间公式，这些是原始 Markdown 写法，写入 JSON 字符串时需转义反斜线。代码块与行内代码保留原文。视频、音频、PDF 和参考文献已有内置组件，先查询对应 guide/schema/examples。文件组件使用 src 保存在线文件地址或对应 MIME 的 base64 data URI；本地上传单文件最多 6 MB，整页最多 10 MB。在线地址需要网络，PDF 地址还需允许跨域读取；离线导出必须嵌入文件与视频封面。参考文献保存稳定的条目 id，正文 `[1](#ref-条目ID)` 可跳转；编号跟随列表顺序变化，调整文献顺序后同步核对正文引用数字。

用户要求新建或修改可复用模板，或把页面提炼成模板时，进入 [create-template](../create-template/SKILL.md)。该技能可先按本技能完成实例再提炼，也可直接保存模板再生成应用预览；完成实例后返回模板创建流程。应用已有模板创建普通页面仍属于本技能，使用 `guide templates` 与所选模板的 `guide`；普通页面完成不会自动触发模板创建。

创建或修改页面后，默认交付包括对话内预览。保存页面后读取 [对话展示](references/conversation-display.md)，导出 inline 并执行当前宿主的实际呈现流程。Codex 支持对话可视化时，在最终回复发送 inline 文件的可视化引用。通过读取图像或操作导出阅读器检查结果，完整 HTML 链接作为补充交付。工作台编辑器与原生行为的验收使用对应软件界面。展示范围可以是完整页面、一个组件、多个组件或整个区域。用户只要局部修改结果，或自动化只更新监控进度时，保存完整页面后只展示相关部分。沿用对应节点的稳定 ID，让后续更新能重复选择同一组件。

局部展示先从 `pages read` 的 `document.content` 找到节点 `attrs.id`，再读取 `guide export` 确认当前运行时支持 `--blocks`。旧运行时缺少该参数时先更新 ShowAI 软件：

```sh
showai export --project PROJECT --page PAGE --blocks PROGRESS_BLOCK_ID --format inline --out ./progress-inline.html --overwrite --json
showai export --project PROJECT --page PAGE --blocks CHART_BLOCK_ID,METRICS_BLOCK_ID --format html --out ./selected.html --json
```

`--blocks` 使用页面中的组件实例或区域 ID；选中区域会包含其全部子内容。多个 ID 用逗号分隔，按页面顺序展示。自定义组件代码内部的子组件需要成为独立页面节点才能单独选择。局部导出默认使用 reading 布局并隐藏页面总标题，保留必要父容器，只打包相关组件；显式 `--presentation spatial` 可保留白板布局。旁边的 `.showai.json` 也是局部源文件；页面编辑继续读取完整页面、使用当前 hash、revision 和稳定节点 ID。

整页展示可省略 `--blocks`。inline 内容超过宿主上限时，用 `--blocks` 导出可独立理解的关键区域，或按阅读顺序分成少量片段，在对话里展示并附完整 HTML 链接；继续保留单份完整源页面。宿主未提供对话 HTML 呈现能力时，打开支持的预览并给出完整文件或地址，说明展示位置。交付前检查导出文件与主要交互；支持对话呈现时，最终回复必须包含本轮生成或更新的 inline 引用和简短说明。用户明确要求只保存、只交付文件或后台执行时，采用其指定方式。完整工作台管理界面不进入读者收到的页面。

新空库默认启用独立版本历史。`showai history list/read/compare` 查看版本与来源，`history merge` 预览草稿合并，`history restore` 恢复为新记录。`showai search --query TEXT` 搜索正文、容器、组件和模板；详情见 `guide history`。`--operation-id` 仅用于重试同一请求，`--message` 说明修改目的，`--group` 关联连续编辑。来源优先取实际宿主会话，无法取得时明确为未知。

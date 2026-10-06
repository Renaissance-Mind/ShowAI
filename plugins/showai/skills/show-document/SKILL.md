---
name: show-document
description: 用 ShowAI 创建、修改或导出交互页面、报告和小型网站。优先在明确的已有项目中创作，普通报告默认一页，创建或修改后默认通过 inline 在支持的 Agent 对话中呈现完整页面或选定区域。复用已有组件与模板；组件开发和模板创建由专门技能处理。
---

ShowAI 将内容组织成可阅读、可探索的页面。工作台与 Agent 使用同一份项目文件；组件负责表达，模板负责内容组织。先明确读者需要理解什么，再选择布局与交互，使用用户材料或可核实的数据。

插件只分发技能。沿用本会话已验证的 ShowAI CLI 命令前缀与内容目录；首次使用或目标项目不明确时读取 [运行入口与项目选择](references/runtime.md)。下文 `showai` 代表该外部命令前缀。

用户指定 ShowAI 项目名称、ID 或页面归属时，核对后使用该项目。用户未指定时，按宿主项目目录定位：

```sh
showai projects current --json
```

该命令默认从当前工作目录向上寻找 Git 仓库根目录；没有 Git 仓库时使用当前目录。宿主提供明确的 Codex/Agent 项目目录时，传入 `--source-directory /absolute/project`，该目录按真实路径精确匹配。相同项目目录下的不同 session 共用一个 ShowAI 项目；首次使用时自动创建并记录目录。命令返回 `project.id`、`sourceDirectory`、`resolution` 和 `created`。页面、组件和模板操作省略 `--project` 时沿用同一目录规则；显式 `--project PROJECT` 优先。

用户明确要求独立项目时使用 `projects create`，后续传入其项目 ID。目录项目的归属与 session ID 无关。默认内容库为 `~/.showai`；`--home /absolute/library` 指定另一份内容库，Agent 使用软件提供的启动配置与工作台保持一致。

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

先按用途搜索组件或模板摘要，限制结果数；选中后取 `--view guide`，准备填入数据时取 `schema`，需要参考用法时取 `examples`。普通页面创作无需读取组件源码或整个目录。修改已有页面前读取当前版本、查看差异，并使用当前 hash 保存。

读取 Page 默认使用结构化 JSON；正文阅读可选择 Markdown。长页面先用 `--detail outline` 取得组件与区域 ID，再按 `--blocks` 读取局部。配色、布局、遮挡和选中状态等视觉问题使用 image，悬停、拖动、展开和表单行为使用 html。按需要读取 [Page 三种读取视图](references/page-reading.md) 与 `guide reading`。三种视图记录同一页面 hash、组件版本及渲染状态；修改视觉后查看图像，修改交互后实际操作 HTML。正式编辑使用完整页面的当前 hash。

已有组件能够表达内容时直接复用。通过调整数据或组合已有组件能实现需求时采用组合；需要可复用的新交互、图形或布局时，进入 [create-component](../create-component/SKILL.md)，完成后回到页面创作。选库失败本身并不意味着必须写组件，先判断普通文本、表格和既有组件的组合是否足够。

用户要求新建或修改可复用模板，或把页面提炼成模板时，进入 [create-template](../create-template/SKILL.md)。该技能可先按本技能完成实例再提炼，也可直接保存模板再生成应用预览；完成实例后返回模板创建流程。应用已有模板创建普通页面仍属于本技能，使用 `guide templates` 与所选模板的 `guide`；普通页面完成不会自动触发模板创建。

创建或修改页面后，默认交付包括对话内预览。保存页面后读取 [对话展示](references/conversation-display.md)，导出 inline 并执行当前宿主的实际呈现流程。Codex 支持对话可视化时，在最终回复发送 inline 文件的可视化引用；打开 ShowAI 或预览面板用于检查，完整 HTML 链接作为补充交付。展示范围可以是完整页面、一个组件、多个组件或整个区域。用户只要局部修改结果，或自动化只更新监控进度时，保存完整页面后只展示相关部分。沿用对应节点的稳定 ID，让后续更新能重复选择同一组件。

局部展示先从 `pages read` 的 `document.content` 找到节点 `attrs.id`，再读取 `guide export` 确认当前运行时支持 `--blocks`。旧运行时缺少该参数时先更新 ShowAI 软件：

```sh
showai export --project PROJECT --page PAGE --blocks PROGRESS_BLOCK_ID --format inline --out ./progress-inline.html --overwrite --json
showai export --project PROJECT --page PAGE --blocks CHART_BLOCK_ID,METRICS_BLOCK_ID --format html --out ./selected.html --json
```

`--blocks` 使用页面中的组件实例或区域 ID；选中区域会包含其全部子内容。多个 ID 用逗号分隔，按页面顺序展示。自定义组件代码内部的子组件需要成为独立页面节点才能单独选择。局部导出默认使用 reading 布局并隐藏页面总标题，保留必要父容器，只打包相关组件；显式 `--presentation spatial` 可保留白板布局。旁边的 `.showai.json` 也是局部源文件；页面编辑继续读取完整页面、使用当前 hash 和稳定节点 ID。

整页展示可省略 `--blocks`。inline 内容超过宿主上限时，用 `--blocks` 导出可独立理解的关键区域，或按阅读顺序分成少量片段，在对话里展示并附完整 HTML 链接；继续保留单份完整源页面。宿主未提供对话 HTML 呈现能力时，打开支持的预览并给出完整文件或地址，说明展示位置。交付前检查导出文件与主要交互；支持对话呈现时，最终回复必须包含本轮生成或更新的 inline 引用和简短说明。用户明确要求只保存、只交付文件或后台执行时，采用其指定方式。完整工作台管理界面不进入读者收到的页面。

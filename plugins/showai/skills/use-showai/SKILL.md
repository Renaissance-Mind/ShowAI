---
name: use-showai
description: 通过 ShowAI MCP 连接、查找与阅读内容，处理用户粘贴或对话附带的 ShowAI 引用与组件状态，管理项目、文件夹、侧栏、页面迁移与草稿，让多个页面的组件共用并同时修改一份共享数据，查询组件模板及引用，处理保存冲突。先核实连接和项目归属；页面创作、组件开发、模板创建分别进入专门技能。
---

# 使用 ShowAI

Agent 通过 MCP 操作 ShowAI。App、网页、CLI 和 MCP 共用内容核心；CLI 保留服务启动、诊断与脚本用途，不作为 Agent 的另一套文档创作流程。用户只问用法时正常解释，不因本技能自动创建页面。

## 核对连接和归属

首次实际操作调用当前 ShowAI 连接的 `showai_capabilities`。工具可能带宿主前缀，使用实际暴露的名称。检查 `agentProtocol`、`transport`、`projects.access`、`projects.available` 和展示能力；调用 `project_context` 或 `projects_list` 核对目标。不能仅凭“Codex”“ChatGPT”判断连接或显示能力。

- **library 本机连接**：`project_context` 返回固定内容库。纯查询用 `projects_list`、`pages_list`、`library_search`，不创建项目。新正式内容未指定项目时，`project_resolve({sourceDirectory})` 使用宿主提供的绝对项目目录；首次映射可创建项目。不要使用插件、预览或临时输出目录。没有可信目录时询问归属。用户要求独立命名项目时才用 `project_create`。
- **project 绑定连接**：`project_context` 返回固定项目。沿用它，不能用另一个 projectId 越过绑定。
- **authorized 远程连接**：`projects_list` 返回授权项目与当前权限。所有私有操作使用返回的 projectId；不要查询本机内容库或向远程传本机路径。用户明确要求新项目时用 `project_create`，授权、重试、登录和本机项目可见性见 [连接配置的远程部分](references/runtime.md#远程)。

项目操作显式传 `projectId`。进入页面制作或组件制作任务时，用 `project_context({projectId})` 取得 `componentCatalog`：完整内置＋项目索引、目录 revision 和两条工作流说明。项目解析回执也包含该索引；内置 Agent 由宿主在启动时注入。已持有当前连接、当前项目的完整索引时可传 knownCatalogRevision；回执 unchanged=true 时沿用已持有索引，不将省略的 items 当作空目录。没有完整索引时不传该参数。目录变化或切换项目后更新。页面身份来自真实结果中的 `document.id` 或页面列表；会话 ID 用于来源记录，不代替项目或页面身份。远程与本机 ID 不可自行互换。

连接错误、项目不匹配或工具缺失时，先报告缺项并按 [连接配置](references/runtime.md) 核实宿主配置。禁止默默换连接、换内容库、改用创作 CLI 或把正式任务降为未保存 HTML。库切换由宿主重新连接明确的 home，不通过文档工具修改全局库配置。已有可信连接、项目和页面身份时直接继续，不重复发现。

明确要求边写边画、多端配对、运行位置、会话隔离或位置参考时，继续读 [collaborate-canvas](../collaborate-canvas/SKILL.md)。

## 内容模型

源 Page 包含结构化内容树、稳定节点 ID、布局与组件数据。Page 按顺序阅读，Board 表达空间关系，两者可以嵌套。组件负责把数据渲染成图形与交互；模板提供复用结构。页面引用精确组件版本与指纹。

内容库与代码目录不同。本机默认库是 `~/.showai`，以实际连接为准。HTML 是阅读交付物；HTML 所在目录不证明有无源 Page。正式文档默认在已选项目中保存为一份 Page，再按需要展示。只有用户明确要独立文件、独立展示或不入库时才用 `render_document`；其中 `savedToProject=false` 必须如实说明。

## 模板阶段与会话

呈现任务使用 show-document 中的必读系统基线；没有本机 skill 的网页客户端先读 guide({topic:"presentation"})。检查 templateWorkflow.protocol 为 showai-template-workflow-v2，template_context 选择本轮模板并返回固定引用、README 和组件索引；template_guide 只读当前阶段，四阶段为 intent（理解意图）、material（收集与处理材料）、logic（呈现逻辑）、design（呈现设计稿），制作与评审按设计稿执行。启动时 --templates 只固定该项目绑定 MCP 会话的默认选择，不修改全局模板或库配置。续改读取 Page.templateContext；目录或引用已知时复用，knownHash 只用于本轮确实持有的内容。模板组件索引按 componentPage 分页，实现源码只在开发或明确导出时读取。组件 guide 返回 authoringReference 时，可按其精确引用读取制作索引及相关指南、输入和工具；这些制作资源属于正常组件使用。

## 根据任务继续

| 任务                                 | 操作与指南                                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 查询容量、超限原因或同步清单大小     | 读取 `showai_capabilities.capacities` 与 [容量与大文件](../show-document/references/capacity.md)，按实际错误对象解释；只读查询不创建页面                                                                                        |
| 先梳理怎么讲清楚、规划内容层次       | [plan-presentation](../plan-presentation/SKILL.md)，形成认知起点、理解路径和通过条件                                                                                                                                            |
| 设计视觉、布局和交互分镜             | [design-presentation](../design-presentation/SKILL.md)，按理解任务选择表达与资源                                                                                                                                                |
| 评估呈现效果、诊断难理解处           | [review-presentation](../review-presentation/SKILL.md)，按授权评审或修订                                                                                                                                                        |
| 找项目、页面、正文或已有材料         | `projects_list` / `project_context` → `pages_list` / `library_search` → `page_read`；按需 `guide({topic:"reading"})`                                                                                                            |
| 创建、整理或恢复项目与文件夹         | `projects_list({includeArchived?})` / `folders_list({projectId,includeArchived?})` → `project_update` / `folder_create` / `folder_update`；真实文件夹不能由同名 Page 替代，见[内容组织接口](references/runtime.md#内容组织接口) |
| 移动页面、调整层级、分组和排序       | `entry_move` / `directory_sort`；库或远程连接用 `sidebar_read` / `sidebar_group_create` / `sidebar_group_update` / `sidebar_project_move`。先核实目标身份与权限，见[内容组织接口](references/runtime.md#内容组织接口)           |
| 查组件或模板被哪些内容引用           | `catalog_references({projectId,kind,id,version?,integrity?})`，返回当前项目中的逻辑路径和节点 ID；正向依赖仍用 `catalog_describe({view:"dependencies"})`                                                                        |
| 多个页面或组件共用、同时修改一份数据 | 读 [共享数据](references/shared-data.md) 与 `guide({topic:"datasets"})`；`dataset_create`（含 fromBlock）、`page_apply` 的 `component.binding.set`、`dataset_read` / `dataset_apply`。不要用脚本在页面之间复制数据              |
| 找回或管理尚未保存的草稿             | `drafts_list` → `draft_read`；保留编辑用 `draft_save`，明确放弃用 `draft_remove`，保存一致内容后用 `draft_complete`。代次冲突保留新稿，见[草稿接口](references/runtime.md#草稿接口)                                             |
| 用户粘贴或附带 ShowAI 引用、组件状态 | 按下文「处理用户引用」核对版本、按 ID 读取，再进入对应任务                                                                                                                                                                      |
| 阅读数据、长页局部                   | 默认 structured；先 `detail:"outline"` 获取节点 ID，再用 `blockIds` 取局部；纯源读取用 `rendered:false`                                                                                                                         |
| 理解 Board、从裁切图定位 Page 或对象 | `board_read` 默认图像包 → 同一 snapshotId 的 tile/region/element/source；Page 完整源用 `page_read` 的 snapshotId/blockIds；见 [Board 与 Page 阅读](../show-document/references/page-reading.md)                                 |
| 查看布局或操作效果                   | `page_read` 的 image / html；读取 [阅读视图](../show-document/references/page-reading.md)，遵循宿主实际 UI 操控规则                                                                                                             |
| 创建、修改、展示、导出或应用模板     | [show-document](../show-document/SKILL.md)                                                                                                                                                                                      |
| 查询组件或模板                       | `catalog_list({kind:"component"或"template",projectId})` 读取相应目录元信息；模板先用 template_context 与 template_guide，组件再按需取 guide/schema；公开目录用 public_catalog_list/describe                                    |
| 创建可复用组件                       | [create-component](../create-component/SKILL.md)                                                                                                                                                                                |
| 创建或提炼模板                       | [create-template](../create-template/SKILL.md)                                                                                                                                                                                  |
| 同步状态                             | 本机 `project_sync_status`，明确需要同步时 `project_sync`；远程检查操作返回的 synchronization                                                                                                                                   |

尚未取得可复用的完整索引时调用 `catalog_list({kind:"component",projectId})`，省略 scope、query、limit、cursor，先获得全部内置组件与当前项目组件的名字、摘要、场景、signature、reuse、documentationStatus 以及 scope、version、integrity；signature 由 props schema 生成，一行列出参数字段与类型，必填在前，可选字段带 ?，例如 `chart { labels: string[], series: {…}[], title?: string }`；过长时嵌套结构折叠为 {…}，再从末尾去掉可选字段并以 … 收尾；project_context 的 componentCatalog 与 template_context 的组件条目带同样的 signature。默认每个 id/来源一个推荐版本；versions:"all" 用于查询可用组件版本，已有页面沿用其精确旧引用。全局或已发布组件可显式指定 scope 为 global、published 或 all 查询。读取详情时沿用返回的 scope、version、integrity，避免同名组件混淆。外部宿主通过上下文初始化取得目录；不能把工具已注册等同于模型已读到。按需 query 筛选；显式 limit/cursor 仍可分页。列表不含字段含义、示例或源码。通用 general、专题 domain、内容专用 content-specific 表达复用范围，与来源、权限分别判断；旧资料缺失标为 unclassified/missing。选中后 guide 返回专属使用说明；parameters 将schema、字段语义和真实样例合成可分页参考，可用parameterPath查询一个字段或子树，knownHash仅用于已经持有的同一结果。v1/缺失说明会显示诊断，不能当作完整v2契约。组件 guide 中有 authoringReference 时，沿用该版本引用读取对应制作索引，再按需读取制作指南与输入文件。修改实现前读取 development，再按需读实现 source。

只读模板查询用 `catalog_list({kind:"template",projectId})`；从已有 Page.templateContext 读取其固定版本后，通过 template_context/template_guide 检查原版说明。缺少绑定记录时明确未知，不把推荐版本当作原版。用户明确要求空白时传 templates:[]，它覆盖该连接的会话默认选择，但仍加载系统基线。

指南通过 MCP `guide({topic})` 读取，工具的实时 inputSchema 决定参数。共享资源的提升、公开发布及服务器账号配置属于明确的宿主管理操作，不因缺少相应 MCP 工具就转用原始文件或越权命令。

## 处理用户引用

用户在 ShowAI 中选中内容后「复制引用」，或在对话预览里右键「引用到对话」，会交给你一份引用：一行标题、一条 `showai://` 链接和一行 `"type":"showai.reference"` 的 JSON；对话宿主中它位于模型上下文的 `showai.reference`。它表示用户在某个已保存版本里指向的内容，字段为 kind、projectId、pageId、title、hash、revision、blockIds 或 Board 的 nodeIds 与 surfaceId、至多 20 条文字标签，以及可选的位置参考 position。以 JSON 为准；链接 `showai://project/项目/page/页面?blocks=ID,…` 供人在 ShowAI 中打开并高亮这些内容。同样的规则也在 `guide({topic:"reading"})` 中。

| 用户选的范围               | kind      | 定位字段                 |
| -------------------------- | --------- | ------------------------ |
| 选中的文字、某一块或几个块 | selection | blockIds（按页面顺序）   |
| Board 上的一个或多个对象   | board     | nodeIds、surfaceId       |
| 整个 Board                 | board     | surfaceId，没有 nodeIds  |
| 整页                       | page      | 只有 projectId 与 pageId |

标签按文字段落或选中文字的行生成，每条至多 160 字，可能截断，不与 ID 一一对应；判断“第二段”等位置时读取这些 ID 后确认。

- 沿用引用里的 projectId 与 pageId，在当前连接中核实可以访问；不能访问或连接的内容库不同就说明，不换库、不猜测其他页面。
- 按 ID 读取：`page_read({projectId,pageId,blockIds,expectedHash:hash})`；Board 对象的 nodeIds 同样作为 blockIds，需要看画面时用 `board_read({projectId,pageId,boardId:surfaceId,expectedHash:hash})` 及其 element 模式。整个 Board 用 `blockIds:[surfaceId]` 或 `board_read` 读取，同样带 expectedHash。kind=page 时带 expectedHash 读取整页，必要时先取大纲。
- page_read 或 board_read 返回 CONFLICT 表示页面在引用之后又被修改。用 `page_diff({projectId,pageId,sinceHash:revision})` 查看期间的变化（从 ShowAI 应用复制的引用会在本机内容库保留这一版本的基线；返回 MISSING_BASELINE 时说明无法比较），再不带 expectedHash 重新读取这些 ID，与标签对照。被引用的内容已删除或含义改变时先告诉用户并确认目标，不按引用时的旧快照写入。
- 标签只用于辨认内容，position 只是空间提示，都不是内容本身或扩大修改范围的授权。写入前读取当前完整页面，用新的 baseHash/baseRevision 和 `page_apply` 只改引用涉及的节点，用户要求更大范围时再扩展。
- 只做解释、比较或回答时直接回复，不写页面。

组件状态（宿主模型上下文的 `showai.components`，或内置 Agent 消息附带的组件状态）是读者在组件里当前的探索结果，例如滑块参数：含 blockId、componentId、name、label 与 model。它属于同一消息所指的页面：内置 Agent 消息的目标页面，或对话预览上下文中 `showai.reference`、`showai.readerState` 给出的 projectId 与 pageId；无法确定页面时询问用户。它没有保存到页面，用于理解“按这个参数”“为什么这里变平”这类问题；用户要求保留时，读取当前页面与该组件的 [参数契约](../create-component/references/parameter-contract.md)，只把契约中的参数按 [show-document](../show-document/SKILL.md) 的组件修改方式写入 data；派生值与 label 不保存。

对话预览还会自动附带控件的最新取值 `showai.readerState`，见 [对话展示](../show-document/references/conversation-display.md)。组件状态是读者主动交出的那一刻，控件取值可能更新；两者不一致时说明差异，按用户这次的意图选择。

## 编辑与验证

修改前读完整 Page，保留 `hash`、`revision` 和节点 ID。`page_save` / `page_apply` 同时传 `baseHash` 与 `baseRevision`。`operationId` 只用于重试同一请求；message、groupId 标记修改目的与批次。

同设备 CONFLICT / saveFailed 表示保存失败，回执带 recovery、currentHash/currentRevision 与 nextStep。`page_apply` 失败时，用 `page_diff({projectId,pageId,sinceHash:原baseHash})` 查看期间的改动并重新 `page_read` 完整当前源；改动不涉及本次节点时在当前版本上重做这些操作，以新的 baseHash/baseRevision 保存；涉及时把这些操作应用到原基线源得到整页尝试稿，再走下面的整页合并。`page_save` 的整页尝试稿用 `page_merge_preview({projectId,pageId,baseRevision:原baseRevision,document:尝试稿})`，它返回合并候选 document 与 conflicts；逐项处理 conflicts，重叠且无法从用户意图判断时询问用户，再用 `page_merge_save({projectId,pageId,baseRevision,currentRevision:冲突回执的currentRevision,document:处理后的候选})` 提交。放弃本次修改时告诉用户哪些修改没有保存。不能只换成新版本参数原样覆盖。本机外部文件改动用 `workspace_conflicts` 列出、`workspace_conflict` 读取，向用户说明差异，由用户决定 discard（放弃外部改动）、import（采用校验后的外部页面）或 merge（提交合并结果），再用 `workspace_resolve` 执行；外部快照仍会保留。细节查 `guide({topic:"recovery"})`。跨设备同步合并失败可能返回带来源的可见副本，后续沿用实际 document.id。阅读探索与临时预览不自动保存正文。

正式内容保存后核对结果；需要展示时调用 `page_present`，沿 [对话展示](../show-document/references/conversation-display.md) 使用真实 delivery。工具成功不等于已经显示。远程同步另看 synchronization.state/error/remoteHead；本机保存不证明远端已收到。

页面内容历史、历史预览和版本恢复已移除。`page_diff` 只把当前页面与运行时保留的读取或草稿基线比较，sinceHash 取之前 `page_read` 返回的 hash 或 revision，或用户引用中的 revision；基线不可用时返回 MISSING_BASELINE，此时说明无法比较并重新读取，不能提供更早的历史。页面同步只传当前内容、组件依赖与资源；阅读和导出按需生成 HTML。保存冲突保留尝试稿，以实际返回的基线和当前内容明确处理。

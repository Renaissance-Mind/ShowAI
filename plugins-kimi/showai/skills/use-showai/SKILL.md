---
name: use-showai
description: 连接 ShowAI 或通过 MCP 管理内容、确定项目、续改作品、制作组件或模板的入口。使用随包或宿主已有的 MCP 连接，需要配置时按 ChatGPT、Grok Bot 或其他宿主引导。在聊天里看可视化时直接使用 show-visual。
---

# 使用 ShowAI

Agent 通过 MCP 操作 ShowAI。App、网页、CLI 和 MCP 共用内容核心；CLI 保留服务启动、诊断与脚本用途，不作为 Agent 的另一套创作流程。这份 Skill 是总入口：先按用户要的结果选路径，再按下面的通用规则核对连接、项目与保存。用户只问用法时正常解释，不因本 Skill 自动创建页面。

## 选择路径

用户要连接 ShowAI、当前会话找不到工具，或已有连接提示未登录时，先走[连接向导](references/connect-mcp.md)。已连通时直接选下表中的任务。

| 用户要的结果 | 典型说法 | 路径 |
| --- | --- | --- |
| 讨论或解释 | “解释一下”“这两个怎么选” | 直接回答；文字、Markdown 表格或 Mermaid 足够时不调用 ShowAI |
| 在对话里看、试或比较 | “画出来看看”“演示一下这个机制”“做个对比图”“给我看个界面原型” | [show-visual](../show-visual/SKILL.md)：直接编写 HTML 并用 `show_component` 展示，明确要求已有组件时才查目录；不需要项目、不保存。展示后用户说“存下来”，也按 show-visual 的“之后要保存”处理 |
| 创作或修改作品 | “整理成文档/报告”“做一份讲解页”“把上周那页的结论改清楚”“先帮我规划怎么讲、出设计稿”“评审这页并修改” | 按下文核对连接与归属，再读 [show-document](../show-document/SKILL.md)：它一次给全制作流程（也用于只要规划、设计稿或评审的请求），选用模板时再补充模板的方法 |
| 查找、阅读或管理已有内容 | “上周那页在哪个项目里”“这个项目里有什么”“哪些页面引用了这一页”“把这三页移到新文件夹”“删掉那页，过几天再找回来”“删掉不用的组件版本”“页面接上这份 Excel” | 留在本 Skill，按 [按任务查找操作](references/tasks.md) 选工具；有 `showai.reference` 时先按 [用户引用](references/user-references.md) 读取它指向的内容 |
| 从其他应用导入 | “把这个 Notion 导出导进来”“导入这份 Word”“以后要能导入 OPML” | 留在本 Skill，按 [导入与导入器](references/import.md) 先给计划、确认后导入；新格式写一个导入器保存到项目 |
| 处理页面评论 | “处理这页的评论”“回复一下评论” | page_read 读出未解决的评论，按 [评论](references/authoring.md#评论) 逐条改页面、回复并解决 |
| 做可复用组件或扩展工作台 | “做一个组件”“改一下这个组件”“让正文里能 @ 提及同事”“给 ⌘K 加一条命令”“数据库要一个评分字段” | 先看 [扩展点](references/extension-points.md) 确认要填入哪个位置，再按 [create-component](../create-component/SKILL.md) 制作；导入新格式见上一行 |
| 做或提炼模板 | “存成模板”“做一个某类内容的模板” | [create-template](../create-template/SKILL.md) |
| 边写边画、多端协作 | “在画布上一起画”“和 iPad 配对” | [collaborate-canvas](../collaborate-canvas/SKILL.md) |

区分“创作或修改作品”和“查找、阅读或管理”的依据，是这次任务会不会写作品内容：新建一页，或改写、补充、重组已有页面的内容，都在决定读者看到什么、怎样讲清楚，进入 show-document；找页面、读内容回答问题、移动整理、接数据源、处理冲突和草稿，不改作品内容，留在本 Skill。区分“在对话里看”和“创作”的依据，是结果要不要留存、继续编辑或交给别人。展示之后用户要保存时按 show-visual 的“之后要保存”处理。展示不写入任何内容库；创作路径的连接或保存失败不改用展示，展示失败也不自动建项目。

## 核对连接和归属

在聊天里一次展示 1–5 幅图，按 show-visual 直接写 HTML 并展示。本机和远程连接都可复用已知的宿主交付方式。只需核对显示声明时用 `showai_capabilities({view:"presentation"})` 取声明和组件数上限。项目归属、跨组件事件和持续更新按各自流程核实。

访问项目时，如果连接信息未知或发生变化，调用一次 `showai_capabilities` 取完整报告，复用当前连接已经核实的结果。工具可能带宿主前缀，使用实际暴露的名称。检查 `agentProtocol`、`transport`、`projects.access` 和 `projects.available`；HTTP 连接同时检查 `projects.storage`，`local` 表示桌面直接保存。调用 `project_context` 或 `projects_list` 核对目标。

- **library 本机连接**：`project_context` 返回固定内容库。纯查询用 `projects_list`、`pages_list`、`library_search`，不创建项目。新正式内容未指定项目时，`project_resolve({sourceDirectory})` 使用宿主提供的绝对项目目录；首次映射可创建项目。不要使用插件、预览或临时输出目录。宿主当前工作目录是用户的项目或代码仓库、且内容与之相关时可以作为可信目录；对话整理、与当前目录无关的内容或没有可信目录时询问归属。用户要求独立命名项目时才用 `project_create`。
- **project 绑定连接**：`project_context` 返回固定项目。沿用它，不能用另一个 projectId 越过绑定。
- **authorized 远程连接**：`projects_list` 返回授权项目与当前权限。所有私有操作使用返回的 projectId；不要查询本机内容库或向远程传本机路径。用户明确要求新项目且连接实际提供 `project_create` 时使用它；桌面完整内容库授权支持新建及后续项目；受限模式按当前工具和权限处理。授权、重试、登录和本机项目可见性见 [连接配置的远程部分](references/runtime.md#远程)。

项目操作显式传 `projectId`。进入页面制作或组件制作任务时，用 `project_context({projectId})` 取得 `componentCatalog`：完整内置＋项目索引、目录 revision 和两条工作流说明。项目解析回执也包含该索引，页面或组件制作时按需取得。已持有当前连接、当前项目的完整索引时可传 knownCatalogRevision；回执 unchanged=true 时沿用已持有索引，不将省略的 items 当作空目录。没有完整索引时不传该参数。目录变化或切换项目后更新。页面身份来自真实结果中的 `document.id` 或页面列表；会话 ID 用于来源记录，不代替项目或页面身份。远程与本机 ID 不可自行互换。

连接错误、项目不匹配或工具缺失时，先报告缺项并按 [连接配置](references/runtime.md) 核实宿主配置；只看到 `showai_connection_problem` 时调用它并转述原因与修复步骤。完全没有 ShowAI 工具（宿主报 Connection closed 等）时，先区分连接类型：HTTP 连接按[远程连接](references/runtime.md#远程)检查地址、设备和授权；本机 stdio 插件按[连接中断或没有工具](references/runtime.md#连接中断或没有工具)处理。工具报错时按 [错误码与下一步](references/runtime.md#错误码与下一步) 判断能否自行修正；无法恢复时，按 [无法恢复的失败与反馈](references/runtime.md#无法恢复的失败与反馈) 告诉用户失败的步骤和错误码，并指向「设置 → 关于与反馈」。保存或创作失败时，把用户要保存的内容留在对话中，便于修复后重试。用户说页面里的组件报错、显示不出来时，按 [组件显示异常](references/runtime.md#组件显示异常) 处理。继续沿用当前连接和内容库：把失败原因告诉用户，内容留在对话中，等连接恢复后在同一项目里完成。库切换由宿主重新连接明确的 home，不通过文档工具修改全局库配置。已有可信连接、项目和页面身份时直接继续，不重复发现。

明确要求边写边画、多端配对、运行位置、会话隔离或位置参考时，继续读 [collaborate-canvas](../collaborate-canvas/SKILL.md)。

## 内容模型

会话展示可以一次给完，也可在实际支持的 MCP Apps 宿主中连续更新同一个显示区，操作流程见 show-visual。核对 capabilities.presentation.liveUpdates 和宿主能力；显示文件片段的能力不等于持续更新能力。正式页面沿 show-document 的原有流程；持续展示的 viewId 是连接内的临时身份，不是 projectId 或 pageId。

源 Page 包含结构化内容树、稳定节点 ID、布局与组件数据。Page 按顺序阅读，Board 表达空间关系，两者可以嵌套。组件负责把数据渲染成图形与交互；模板提供复用结构。页面引用精确组件版本与指纹。

内容库与代码目录不同。本机默认库是 `~/.showai`，以实际连接为准。HTML 是阅读交付物；HTML 所在目录不证明有无源 Page。正式文档默认在已选项目中保存为一份 Page，保存后按当前工作流的「当前宿主交付」给出原页入口。对话中看一眼的组件用 `show_component`；需要一份完整独立文件但不入库时才用 `render_document`。两者都返回 `savedToProject=false`，必须如实说明。

## 保存与冲突

修改前读完整 Page，保留 `hash`、`revision` 和节点 ID；`page_save` / `page_apply` 同时传 `baseHash` 与 `baseRevision`。返回 CONFLICT 或 saveFailed 表示没有保存成功：比较原基线、当前内容和尝试稿，保留无关修改，重叠且无法从用户意图判断时询问用户；不能只换成新版本参数原样覆盖。放弃修改时告诉用户哪些内容没有保存。page_diff、合并预览、外部文件改动和共享数据冲突的具体做法见 [保存、冲突与页面差异](references/editing.md)。

正式内容保存后核对结果。工具成功不等于用户已经看到，本机保存不证明远端已收到，远程同步另看 synchronization。

## 参考

- [操作格式](references/formats/authoring.json)、[内容树](references/formats/document.json)、[原生容器](references/formats/containers.json)与[协议变化](references/formats/migrations.json)：按需读取的参数参考，由源码契约生成；实际工具 inputSchema 与调用回执决定当前可用范围。
- [按任务查找操作](references/tasks.md)：查找、阅读、整理、草稿、同步、容量、大参数文件、组件与模板查询等任务用到的工具。
- [写入页面的操作](references/authoring.md)：建页、插入与修改组件、文字标记、图片与媒体、链接、展示与导出。
- [用户引用与组件状态](references/user-references.md)：用户粘贴的 `showai.reference`、组件状态和控件取值。
- [保存、冲突与页面差异](references/editing.md)。
- [导入与导入器](references/import.md)：Notion、Word、Markdown 导入的计划与回执，以及新增一种格式的导入器。
- [扩展点](references/extension-points.md)：快速跳转命令、@ 菜单、数据库字段类型、页面目录和导入器这几个可填入的位置，各由谁提供、填入者声明什么，以及用 `catalog_list({kind:"contribution"})` 一次查出已填入的内容。
- [共享数据](references/shared-data.md)、[页面与 Board 阅读](references/page-reading.md)、[Board 对象编辑](references/board-authoring.md)、[容量与大文件](references/capacity.md)。
- [宿主显示](references/host-display.md) 与 [完整宿主适配](references/host-adapter.md)：回执与工作流不符、显示失败或需要特殊交付时查阅。
- [连接配置](references/runtime.md) 与 [集成](references/integration.md)：连接、错误码、远程授权与反馈。

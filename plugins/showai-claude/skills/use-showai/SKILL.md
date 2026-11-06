---
name: use-showai
description: ShowAI 的总入口，通过 ShowAI MCP 做任何事都先读它。按用户要的结果分流：创作或修改作品（含只要规划、设计稿或评审）、在对话里展示组件、查找阅读与管理已有内容、做组件或模板、多端协作；并给出连接与项目归属、内容模型、保存与冲突的通用规则。查找、引用、共享数据（含外部 JSON/CSV/Excel）、草稿和内容库切换的做法在它的参考里。连接或显示异常时保留内容并指向「设置 → 关于与反馈」。
---

# 使用 ShowAI

Agent 通过 MCP 操作 ShowAI。App、网页、CLI 和 MCP 共用内容核心；CLI 保留服务启动、诊断与脚本用途，不作为 Agent 的另一套创作流程。这份 Skill 是总入口：先按用户要的结果选路径，再按下面的通用规则核对连接、项目与保存。用户只问用法时正常解释，不因本 Skill 自动创建页面。

## 选择路径

| 用户要的结果 | 典型说法 | 路径 |
| --- | --- | --- |
| 讨论或解释 | “解释一下”“这两个怎么选” | 直接回答；文字、Markdown 表格或 Mermaid 足够时不调用 ShowAI |
| 在对话里看、试或比较 | “画出来看看”“演示一下这个机制”“做个对比图”“给我看个界面原型” | [show-visual](../show-visual/SKILL.md)：选现有组件，或改造、新建一个组件，用 `show_component` 展示；不需要项目、不保存。展示后用户说“存下来”，也按 show-visual 的“之后要保存”处理 |
| 创作或修改作品 | “整理成文档/报告”“做一份讲解页”“把上周那页的结论改清楚”“先帮我规划怎么讲、出设计稿”“评审这页并修改” | 按下文核对连接与归属，再读 [show-document](../show-document/SKILL.md)：它一次给全制作流程（也用于只要规划、设计稿或评审的请求），选用模板时再补充模板的方法 |
| 查找、阅读或管理已有内容 | “上周那页在哪个项目里”“这个项目里有什么”“把这三页移到新文件夹”“页面接上这份 Excel” | 留在本 Skill，按 [按任务查找操作](references/tasks.md) 选工具；有 `showai.reference` 时先按 [用户引用](references/user-references.md) 读取它指向的内容 |
| 做可复用组件 | “做一个组件”“改一下这个组件” | [create-component](../create-component/SKILL.md) |
| 做或提炼模板 | “存成模板”“做一个某类内容的模板” | [create-template](../create-template/SKILL.md) |
| 边写边画、多端协作 | “在画布上一起画”“和 iPad 配对” | [collaborate-canvas](../collaborate-canvas/SKILL.md) |

区分“创作或修改作品”和“查找、阅读或管理”的依据，是这次任务会不会写作品内容：新建一页，或改写、补充、重组已有页面的内容，都在决定读者看到什么、怎样讲清楚，进入 show-document；找页面、读内容回答问题、移动整理、接数据源、处理冲突和草稿，不改作品内容，留在本 Skill。区分“在对话里看”和“创作”的依据，是结果要不要留存、继续编辑或交给别人。展示之后用户要保存时按 show-visual 的“之后要保存”处理。展示不写入任何内容库；创作路径的连接或保存失败不改用展示，展示失败也不自动建项目。

## 核对连接和归属

首次实际操作时调用 `showai_capabilities`；宿主没有安装 ShowAI Skill 时，先读当前连接的 `guide()` 入口说明。工具可能带宿主前缀，使用实际暴露的名称。检查 `agentProtocol`、`transport`、`projects.access`、`projects.available` 和展示能力；HTTP 连接同时检查 `projects.storage`（或 `guide().connection.storage`），`local` 表示桌面直接保存。调用 `project_context` 或 `projects_list` 核对目标。不能仅凭“Codex”“ChatGPT”判断连接或显示能力。

- **library 本机连接**：`project_context` 返回固定内容库。纯查询用 `projects_list`、`pages_list`、`library_search`，不创建项目。新正式内容未指定项目时，`project_resolve({sourceDirectory})` 使用宿主提供的绝对项目目录；首次映射可创建项目。不要使用插件、预览或临时输出目录。宿主当前工作目录是用户的项目或代码仓库、且内容与之相关时可以作为可信目录；对话整理、与当前目录无关的内容或没有可信目录时询问归属。用户要求独立命名项目时才用 `project_create`。
- **project 绑定连接**：`project_context` 返回固定项目。沿用它，不能用另一个 projectId 越过绑定。
- **authorized 远程连接**：`projects_list` 返回授权项目与当前权限。所有私有操作使用返回的 projectId；不要查询本机内容库或向远程传本机路径。用户明确要求新项目且连接实际提供 `project_create` 时使用它；桌面远程连接的新项目在 App 创建。授权、重试、登录和本机项目可见性见 [连接配置的远程部分](references/runtime.md#远程)。

项目操作显式传 `projectId`。进入页面制作或组件制作任务时，用 `project_context({projectId})` 取得 `componentCatalog`：完整内置＋项目索引、目录 revision 和两条工作流说明。项目解析回执也包含该索引；内置 Agent 由宿主在启动时注入。已持有当前连接、当前项目的完整索引时可传 knownCatalogRevision；回执 unchanged=true 时沿用已持有索引，不将省略的 items 当作空目录。没有完整索引时不传该参数。目录变化或切换项目后更新。页面身份来自真实结果中的 `document.id` 或页面列表；会话 ID 用于来源记录，不代替项目或页面身份。远程与本机 ID 不可自行互换。

连接错误、项目不匹配或工具缺失时，先报告缺项并按 [连接配置](references/runtime.md) 核实宿主配置；只看到 `showai_connection_problem` 时调用它并转述原因与修复步骤。完全没有 ShowAI 工具（宿主报 Connection closed 等）时按 [连接中断或没有工具](references/runtime.md#连接中断或没有工具) 处理。工具报错时按 [错误码与下一步](references/runtime.md#错误码与下一步) 判断能否自行修正；无法恢复时，按 [无法恢复的失败与反馈](references/runtime.md#无法恢复的失败与反馈) 告诉用户失败的步骤和错误码，并指向「设置 → 关于与反馈」。保存或创作失败时，把用户要保存的内容留在对话中，便于修复后重试。用户说页面里的组件报错、显示不出来时，按 [组件显示异常](references/runtime.md#组件显示异常) 处理。继续沿用当前连接和内容库：把失败原因告诉用户，内容留在对话中，等连接恢复后在同一项目里完成。库切换由宿主重新连接明确的 home，不通过文档工具修改全局库配置。已有可信连接、项目和页面身份时直接继续，不重复发现。

明确要求边写边画、多端配对、运行位置、会话隔离或位置参考时，继续读 [collaborate-canvas](../collaborate-canvas/SKILL.md)。

## 内容模型

源 Page 包含结构化内容树、稳定节点 ID、布局与组件数据。Page 按顺序阅读，Board 表达空间关系，两者可以嵌套。组件负责把数据渲染成图形与交互；模板提供复用结构。页面引用精确组件版本与指纹。

内容库与代码目录不同。本机默认库是 `~/.showai`，以实际连接为准。HTML 是阅读交付物；HTML 所在目录不证明有无源 Page。正式文档默认在已选项目中保存为一份 Page，再按需要展示。对话中看一眼的组件用 `show_component`；需要一份完整独立文件但不入库时才用 `render_document`。两者都返回 `savedToProject=false`，必须如实说明。

## 保存与冲突

修改前读完整 Page，保留 `hash`、`revision` 和节点 ID；`page_save` / `page_apply` 同时传 `baseHash` 与 `baseRevision`。返回 CONFLICT 或 saveFailed 表示没有保存成功：比较原基线、当前内容和尝试稿，保留无关修改，重叠且无法从用户意图判断时询问用户；不能只换成新版本参数原样覆盖。放弃修改时告诉用户哪些内容没有保存。page_diff、合并预览、外部文件改动和共享数据冲突的具体做法见 [保存、冲突与页面差异](references/editing.md)。

正式内容保存后核对结果。工具成功不等于用户已经看到，本机保存不证明远端已收到，远程同步另看 synchronization。

## 参考

- [按任务查找操作](references/tasks.md)：查找、阅读、整理、草稿、同步、容量、大参数文件、组件与模板查询等任务用到的工具。
- [写入页面的操作](references/authoring.md)：建页、插入与修改组件、文字标记、图片与媒体、链接、展示与导出。
- [用户引用与组件状态](references/user-references.md)：用户粘贴的 `showai.reference`、组件状态和控件取值。
- [保存、冲突与页面差异](references/editing.md)。
- [共享数据](references/shared-data.md)、[页面与 Board 阅读](references/page-reading.md)、[Board 对象编辑](references/board-authoring.md)、[容量与大文件](references/capacity.md)。
- [宿主显示](references/host-display.md) 与 [当前宿主适配](references/host-adapter.md)：展示组件和页面前先读。
- [连接配置](references/runtime.md) 与 [集成](references/integration.md)：连接、错误码、远程授权与反馈。

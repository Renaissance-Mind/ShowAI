---
name: use-showai
description: 通过 ShowAI MCP 连接、查找与阅读项目页面、查询组件模板。先核实连接和项目归属；页面创作、组件开发、模板创建分别进入专门技能。
---

# 使用 ShowAI

Agent 通过 MCP 操作 ShowAI。App、网页、CLI 和 MCP 共用内容核心；CLI 保留服务启动、诊断与脚本用途，不作为 Agent 的另一套文档创作流程。用户只问用法时正常解释，不因本技能自动创建页面。

## 核对连接和归属

首次实际操作调用当前 ShowAI 连接的 `showai_capabilities`。工具可能带宿主前缀，使用实际暴露的名称。检查 `agentProtocol`、`transport`、`projects.access`、`projects.available` 和展示能力；调用 `project_context` 或 `projects_list` 核对目标。不能仅凭“Codex”“ChatGPT”判断连接或显示能力。

- **library 本机连接**：`project_context` 返回固定内容库。纯查询用 `projects_list`、`pages_list`、`library_search`，不创建项目。新正式内容未指定项目时，`project_resolve({sourceDirectory})` 使用宿主提供的绝对项目目录；首次映射可创建项目。不要使用插件、预览或临时输出目录。没有可信目录时询问归属。用户要求独立命名项目时才用 `project_create`。
- **project 绑定连接**：`project_context` 返回固定项目。沿用它，不能用另一个 projectId 越过绑定。
- **authorized 远程连接**：`projects_list` 返回授权项目与当前权限。所有私有操作使用返回的 projectId；不要查询本机内容库或向远程传本机路径。

项目操作显式传 `projectId`。进入页面制作或组件制作任务时，用 `project_context({projectId})` 取得 `componentCatalog`：完整内置＋项目索引、目录 revision 和两条工作流说明。项目解析回执也包含该索引；内置 Agent 由宿主在启动时注入。已持有当前连接、当前项目的完整索引时可传 knownCatalogRevision；回执 unchanged=true 时沿用已持有索引，不将省略的 items 当作空目录。没有完整索引时不传该参数。目录变化或切换项目后更新。页面身份来自真实结果中的 `document.id` 或页面列表；会话 ID 用于来源记录，不代替项目或页面身份。远程与本机 ID 不可自行互换。

连接错误、项目不匹配或工具缺失时，先报告缺项并按 [连接配置](references/runtime.md) 核实宿主配置。禁止默默换连接、换内容库、改用创作 CLI 或把正式任务降为未保存 HTML。库切换由宿主重新连接明确的 home，不通过文档工具修改全局库配置。已有可信连接、项目和页面身份时直接继续，不重复发现。

## 内容模型

源 Page 包含结构化内容树、稳定节点 ID、布局与组件数据。Page 按顺序阅读，Board 表达空间关系，两者可以嵌套。组件负责把数据渲染成图形与交互；模板提供复用结构。页面引用精确组件版本与指纹。

内容库与代码目录不同。本机默认库是 `~/.showai`，以实际连接为准。HTML 是阅读交付物；HTML 所在目录不证明有无源 Page。正式文档默认在已选项目中保存为一份 Page，再按需要展示。只有用户明确要独立文件、独立展示或不入库时才用 `render_document`；其中 `savedToProject=false` 必须如实说明。

## 根据任务继续

| 任务                             | 操作与指南                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 查询容量、超限原因或同步清单大小 | 读取 `showai_capabilities.capacities` 与 [容量与大文件](../show-document/references/capacity.md)，按实际错误对象解释；只读查询不创建页面                                                             |
| 找项目、页面、正文或已有材料     | `projects_list` / `project_context` → `pages_list` / `library_search` → `page_read`；按需 `guide({topic:"reading"})`                                                                                 |
| 阅读数据、长页局部               | 默认 structured；先 `detail:"outline"` 获取节点 ID，再用 `blockIds` 取局部；纯源读取用 `rendered:false`                                                                                              |
| 查看布局或操作效果               | `page_read` 的 image / html；读取 [阅读视图](../show-document/references/page-reading.md)，遵循宿主实际 UI 操控规则                                                                                  |
| 创建、修改、展示、导出或应用模板 | [show-document](../show-document/SKILL.md)                                                                                                                                                           |
| 查询组件或模板                   | `catalog_list` 默认返回组件默认范围（内置＋当前项目）的全部名字、摘要、场景与查询身份 → `catalog_describe` 按需取 guide / schema / examples；公开目录用 `public_catalog_list/describe`，同样默认全量 |
| 创建可复用组件                   | [create-component](../create-component/SKILL.md)                                                                                                                                                     |
| 创建或提炼模板                   | [create-template](../create-template/SKILL.md)                                                                                                                                                       |
| 同步状态                         | 本机 `project_sync_status`，明确需要同步时 `project_sync`；远程检查操作返回的 synchronization                                                                                                        |

尚未取得可复用的完整索引时调用 `catalog_list({kind:"component",projectId})`，省略 scope、query、limit、cursor，先获得全部内置组件与当前项目组件的名字、摘要和场景、reuse 与 documentationStatus。默认每个 id/来源一个推荐版本；versions:"all" 用于查询可用组件版本，已有页面沿用其精确旧引用。全局或已发布组件可显式指定 scope 为 global、published 或 all 查询。读取详情时沿用返回的 scope、version、integrity，避免同名组件混淆。外部宿主通过上下文初始化取得目录；不能把工具已注册等同于模型已读到。按需 query 筛选；显式 limit/cursor 仍可分页。列表不含参数、示例或源码。通用 general、专题 domain、内容专用 content-specific 表达复用范围，与来源、权限分别判断；旧资料缺失标为 unclassified/missing。选中后 guide 返回专属使用说明；修改实现前读取 development，再按需读 source。

指南通过 MCP `guide({topic})` 读取，工具的实时 inputSchema 决定参数。共享资源的提升、公开发布及服务器账号配置属于明确的宿主管理操作，不因缺少相应 MCP 工具就转用原始文件或越权命令。

## 编辑与验证

修改前读完整 Page，保留 `hash`、`revision` 和节点 ID。`page_save` / `page_apply` 同时传 `baseHash` 与 `baseRevision`。`operationId` 只用于重试同一请求；message、groupId 标记修改目的与批次。

同设备 CONFLICT / saveFailed 表示保存失败：比较旧基线、当前内容和尝试稿，明确合并或放弃。不能只换成新版本参数原样覆盖。跨设备同步合并失败可能返回带来源的可见副本，后续沿用实际 document.id。阅读探索与临时预览不自动保存正文。

正式内容保存后核对结果；需要展示时调用 `page_present`，沿 [对话展示](../show-document/references/conversation-display.md) 使用真实 delivery。工具成功不等于已经显示。远程同步另看 synchronization.state/error/remoteHead；本机保存不证明远端已收到。

页面历史查看、比较和恢复已移除。页面同步只传当前内容、组件依赖与资源；阅读和导出按需生成 HTML。保存冲突保留尝试稿，以实际返回的基线和当前内容明确处理。

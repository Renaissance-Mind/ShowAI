# 按任务查找操作

这份参考按任务列出用到的工具和参考。连接、归属和保存的通用规则在 [use-showai](../SKILL.md) 正文里。

| 任务 | 操作与指南 |
| --- | --- |
| 查询容量、超限原因或同步清单大小 | 读取 `showai_capabilities.capacities` 与 [容量与大文件](capacity.md)，按实际错误对象解释；只读查询不创建页面 |
| 找项目、页面、正文或已有材料 | `projects_list` / `project_context` → `pages_list` / `library_search` → `page_read`；按需 `guide({topic:"reading"})` |
| 创建、整理或恢复项目与文件夹 | `projects_list({includeArchived?})` / `organization_read({projectId,action:"folders",includeArchived?})` → `organization_update` 的 update_project / create_folder / update_folder；真实文件夹不能由同名 Page 替代，见[内容组织接口](runtime.md#内容组织接口) |
| 删除、找回、复制或置顶页面 | `organization_update` 的 `update_page`（`archived:true` 删除且可恢复，`archived:false` 找回，`pinned`）与 `duplicate_page`；`organization_read` 的 `deleted` 列出可恢复的项目、文件夹和页面。见 [内容组织接口](runtime.md#内容组织接口) |
| 删除不再需要的组件或模板版本 | `catalog_version({projectId,action:"remove",kind,id,version?,scope?})`，scope 为 project（默认）、global 或 published，取 catalog_list 返回的 scope；省略 version 删除该范围的全部版本；global 与 published 改的是共享库，项目绑定的连接会返回 INVALID_PATH，这时请用户在桌面端或 CLI（`showai catalog remove ID --kind KIND --scope SCOPE`）删除；仍被使用时返回 IN_USE 并在 `details.uses` 列出页面与 blockIds、模板包、发布，先征得用户同意改掉这些使用再删；删除写入历史，内置组件和模板不能删除 |
| 移动页面、调整层级、分组和排序 | `organization_update` 的 move / sort；库或远程连接用 `organization_read` 的 sidebar 与 `organization_update` 的 create_group / update_group / move_project。先核实目标身份与权限，见[内容组织接口](runtime.md#内容组织接口) |
| 把页面上的自定义组件换成新版本 | `catalog_references` 找到页面与块 → 每页 `page_read` 取 baseHash/baseRevision → `page_apply` 每块一条 `component.ref.set`（保留块 ID 与 props），见 [create-component 的页面升级到新版本](../../create-component/SKILL.md#页面升级到新版本)；不要删除后重新插入 |
| 查哪些页面引用了某页（反向链接），或某页引用了哪些页面 | `page_read({projectId,pageId,references:"to"或"from"或"both",response:"receipt"})`，见 [页面之间的引用](page-reading.md#页面之间的引用)；要在页面上一直显示时插入 backlinks 组件 |
| 查组件或模板被哪些内容引用 | `catalog_references({projectId,kind,id,version?,integrity?})`，返回当前项目中的逻辑路径和节点 ID；正向依赖仍用 `catalog_describe({view:"dependencies"})` |
| 多个页面或组件共用、同时修改一份数据，组件要读写内容库以外目录中的数据文件，或要从 Excel 等数据计算出组件需要的形状 | 确认 `showai_capabilities.datasets` 后读 [共享数据](shared-data.md) 与 `guide({topic:"datasets"})`；`dataset_read`（list / read）、`dataset_write`（create 含 fromBlock、apply、link 外部 JSON/CSV/TSV/XLSX 文件或在线数据、transform 处理脚本）、`page_apply` 的 `component.binding.set` 或带 `$binding` 的 `component.insert`、`dataset_delete`。页面之间共用数据、读取外部文件都通过共享数据完成，数据只有一份，修改处处一致 |
| 找回或管理尚未保存的草稿 | `draft_read` 的 list → read；保留编辑用 `draft_write` 的 save，明确放弃用 `draft_remove`，保存一致内容后用 `draft_write` 的 complete。代次冲突保留新稿，见[草稿接口](runtime.md#草稿接口) |
| 用户粘贴或附带 ShowAI 引用、组件状态 | 按 [用户引用与组件状态](user-references.md)核对版本、按 ID 读取，再进入对应任务 |
| 阅读数据、长页局部 | 默认 structured；先 `detail:"outline"` 获取节点 ID，再用 `blockIds` 取局部；纯源读取用 `rendered:false` |
| 理解 Board、从裁切图定位 Page 或对象 | `board_read` 默认图像包 → 同一 snapshotId 的 tile/region/element/source；Page 完整源用 `page_read` 的 snapshotId/blockIds；见 [Board 与 Page 阅读](page-reading.md) |
| 查看布局或操作效果 | `page_read` 的 image / html；读取 [阅读视图](page-reading.md)，遵循宿主实际 UI 操控规则 |
| 在对话中直接展示 1–5 个组件 | [show-visual](../../show-visual/SKILL.md)，不建项目、不保存 |
| 创建、修改、展示、导出作品，或应用模板 | [show-document](../../show-document/SKILL.md) |
| 查询组件或模板 | `catalog_list({kind:"component"或"template",projectId})` 读取相应目录元信息；模板用 template_context 一次读完 README 与全部指南，组件再按需取 guide/schema；公开目录用 public_catalog_list/describe |
| 创建可复用组件，包括能在正文 @ 菜单中提及的新类型（人员、事项、文献等） | [create-component](../../create-component/SKILL.md) |
| 创建或提炼模板 | [create-template](../../create-template/SKILL.md) |
| 同步状态 | 本机 `project_sync_status`，明确需要同步时 `project_sync`；远程检查操作返回的 synchronization |
| 大参数或大结果（长操作列表、大数据、组件包、整页源、截图、差异） | `showai_capabilities.authoring.localFiles.available` 为 true 的本机连接用文件：`page_apply` 的 operationsFile、`dataset_write` 的 valueFile / operationsFile / scriptFile、`component_save` 的 directory，`page_read` / `page_diff` / `dataset_read` 的 out，`catalog_describe` view:"source" 的 out。用户要“把页面源数据导出成文件”时用 page_read 的 out（绑定的共享数据再用 dataset_read 的 out），不用 page_export。用户要的文件写到用户指定的绝对路径，没有指定时先询问，用户说随意时放在任务工作目录（宿主提供的草稿目录）；Agent 自己用的中间文件（操作列表、自查截图、核对用的整页源）直接放在任务工作目录，不必询问；制作作品时这些材料放进作品的记录文件夹（见 show-document 的“记录”）。都不写进内容库；已有文件要用户同意后才加 overwrite:true。路径是运行 ShowAI 的这台设备上的绝对路径，只读取不修改输入文件；远程连接或没有该能力的旧运行时不接受这些参数，改为内联。见 `guide({topic:"authoring"})` |

尚未取得可复用的完整索引时调用 `catalog_list({kind:"component",projectId})`，省略 scope、query、limit、cursor，先获得全部内置组件与当前项目组件的名字、摘要、场景、signature、reuse、documentationStatus 以及 scope、version、integrity；signature 由 props schema 生成，一行列出参数字段与类型，必填在前，可选字段带 ?，例如 `chart { labels: string[], series: {…}[], title?: string }`；过长时嵌套结构折叠为 {…}，再从末尾去掉可选字段并以 … 收尾；project_context 的 componentCatalog 与 template_context 的组件条目带同样的 signature。默认每个 id/来源一个推荐版本；versions:"all" 用于查询可用组件版本，已有页面沿用其精确旧引用。全局或已发布组件可显式指定 scope 为 global、published 或 all 查询。读取详情时沿用返回的 scope、version、integrity，避免同名组件混淆。外部宿主通过上下文初始化取得目录；不能把工具已注册等同于模型已读到。按需 query 筛选；显式 limit/cursor 仍可分页。列表不含字段含义、示例或源码。通用 general、专题 domain、内容专用 content-specific 表达复用范围，与来源、权限分别判断；旧资料缺失标为 unclassified/missing。选中后 guide 返回专属使用说明；parameters 将schema、字段语义和真实样例合成可分页参考，可用parameterPath查询一个字段或子树，knownHash仅用于已经持有的同一结果。v1/缺失说明会显示诊断，不能当作完整v2契约。组件 guide 中有 authoringReference 时，沿用该版本引用读取对应制作索引，再按需读取制作指南与输入文件。修改实现前读取 development，再按需读实现 source。

只读模板查询用 `catalog_list({kind:"template",projectId})`；要看某个模板的全部内容时用 `template_context` 传入它的精确引用，返回 README 与全部指南。已有 Page.templateContext 记下的是固定版本，按它读取原版说明；缺少记录时说明未知，不把推荐版本当作原版。用户明确要求空白时传 templates:[]，它覆盖该连接的会话默认选择。

指南通过 MCP `guide({topic})` 读取，工具的实时 inputSchema 决定参数。共享资源的提升、公开发布及服务器账号配置属于明确的宿主管理操作，不因缺少相应 MCP 工具就转用原始文件或越权命令。

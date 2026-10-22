---
name: showai
description: 在 Kimi Work 中通过 ShowAI MCP 查找与阅读内容，在对话里直接展示组件，或按四阶段流程创建和续改可保存的交互页面；也支持组件与模板开发、共享数据和历史恢复。需要留存的内容先保存，再按宿主能力用 Widget 或离线 HTML 展示。
---

# 在 Kimi Work 使用 ShowAI

Agent 通过已连接的 ShowAI MCP 操作文档。用户只问问题时直接回答。只想看一眼图表、示意、模拟或对比且没有留存信号时用对话展示；需要保存、分享、完整文档或续改已有 Page 时走项目页面。连接、保存或导出失败不改变内容归属，不另建项目绕过。

## 连接与归属

首次实际操作调用 `showai_capabilities`，核对 `agentProtocol`、`transport`、`projects`、`templateWorkflow` 与展示能力。工具可能带宿主前缀，使用实际公布的完整名称。工具未暴露时检查插件是否同时安装并启用了 MCP 服务，核对宿主报告的启动错误；报告实际缺项，不反复猜测工具名，不自动启动默认开发服务、不切内容库、不改用创作 CLI 或未保存 HTML。插件安装、运行时版本和会话可见工具是三个分别核验的环节。

- 本机 library 连接：`project_context` 核对固定内容库，纯查询用 `projects_list`、`pages_list`、`library_search`，不创建项目。新正式内容可用 `project_resolve({sourceDirectory})` 解析宿主提供的可信绝对项目目录；没有可信目录时确认归属，不使用插件、Widget 或临时预览目录。用户要求独立命名项目时才用 `project_create`。
- project 绑定连接：沿用 `project_context` 返回的固定项目。
- authorized 远程连接：只用 `projects_list` 返回的授权项目，不查询本机库或传入本机路径。此插件默认配置本机 MCP；远程入口由宿主另外连接。

项目操作显式传 `projectId`。制作前用 `project_context({projectId})` 取得当前组件索引、signature 和目录 revision；已持有同一项目的完整索引时才传 `knownCatalogRevision`。库切换由宿主重新配置绝对 `SHOWAI_HOME` 并连接，不修改全局库设置。实际连接不同于目标时先解决连接，保留现有源内容。

## 查找、续改与恢复

纯阅读用 `pages_list` / `library_search` → `page_read`，长页先 `detail:"outline"` 再按 `blockIds` 读取。需要理解 Board 时读 `guide({topic:"whiteboard"})` 和 `board_read` 的真实快照。引用里的 projectId、pageId 和节点 ID 要在当前连接中核实。

修改前完整读取源 Page：`page_read({projectId,pageId,rendered:false,response:"source"})`，保留 hash、revision 和稳定节点 ID。优先 `page_apply` 的局部操作；它和 `page_save` 都带 `baseHash` / `baseRevision`。`component.props.set` 中列出的顶层键整体替换，嵌套值先读出再修改。每次写入沿用新回执；CONFLICT 时比较基线、当前内容与尝试稿，合并无关改动，不仅更新基线后覆盖。

找回历史先读 `guide({topic:"recovery"})` 与 `guide({topic:"versions"})`，按当前工具 schema 查询和恢复目标版本，保留原文与完整历史。草稿使用 `draft_read` / `draft_write`，外部改动使用 `workspace_conflict`；工具 action 与恢复参数从当前 guide 获取，不猜旧版命令。

共享数据先核对 capabilities.datasets，再读 `guide({topic:"datasets"})`，使用 `dataset_read` / `dataset_write` / `dataset_delete`。多个页面共用一份数据时建立绑定；外部 JSON/CSV/TSV 文件通过 `dataset_write` 的 link 接入，导出含外部数据前核对 `externalSnapshots` 并取得分享同意。

## 对话展示

不创建项目、不保存：查 `public_catalog_list` 或已有项目的 `catalog_list`，读取所选组件 `view:"guide"` 和需要的参数说明，再调用 `show_component({kind,data,delivery:"fragment-file"})`；一次最多 5 个组件可用 `blocks`。参数取自当前 guide/schema，不凭组件名称猜字段。标为 `conversation:"limited"` 且需要联网的组件，在离线 Widget 中改用适合的组件或 `delivery:"image"`。

按下文 Widget 流程显示 `delivery.inline`，如实说明没有保存。用户随后只要求保存这几个组件时，核对项目后将同一份 `{kind,data}` 原样作为 `page_create` 的 blocks 或 `component.insert` 写入，再 `page_present`；多次展示要整理成完整文档时，把已有数据作为材料走四阶段。

## 项目页面的四个阶段

先读 `guide({topic:"presentation"})` 的系统基线，核对 `templateWorkflow.protocol` 为 `showai-template-workflow-v2`。没有四阶段能力时修复运行时连接，安装 Skill 本身不会升级协议。完整作品持续完成四阶段、制作、评审和交付；只要求规划或设计稿时按用户要求交付对应记录。

复杂新作品先查模板目录 `catalog_list({projectId,kind:"template"})`。用户指定模板优先；适配时选用，空白作品显式传 `templates:[]`。续改读取 Page.templateContext，沿用精确引用。`template_context({projectId,templates?})` 返回系统基线、模板 README、固定引用和组件索引，保留 context.templates，按 componentPage 分页。进入一个阶段时才读 `template_guide({projectId,stage,templates:context.templates})`，一次一阶段；knownHash / knownSystemHash 只用于本轮实际读过的内容。

| 阶段 | 产出 |
| --- | --- |
| intent 理解意图 | 读者简报：实际任务、已有知识、缺口、误解、完成条件与环境 |
| material 收集与处理材料 | 材料底稿：真实来源、数据、条件、核查结果和缺口；按指南判断通用场景是否可省略 |
| logic 呈现逻辑 | 呈现规划：整体顺序、每个主题要解释的内容、逐层细化与通过条件 |
| design 呈现设计稿 | 设计稿：环境、每幕的对象与关系、布局、文字落点、视觉、交互、窄屏与静态方式 |

简单任务可合并记录，仍完成每项判断。根据读者任务组织内容，适合的关系优先用图形表达，文字补足必要解释。制作按设计稿进行：`template_apply` 创建绑定模板的空 Page，或 `page_create` 传少量 `blocks:[{kind,data}]`；按幕顺序逐次 `page_apply`，不手写整棵文档。读取 `guide` 的 authoring / containers / document 取得当前操作协议。每幕记录对应 blockIds。

选择组件后读精确 guide，按 parameterPath 查询字段语义与约束；复用模板返回的 componentId/version/integrity。组件开发先查目录和组合能力，确有表达缺口时读 `guide({topic:"component"})`，按当前 schema 用 `component_save` 保存 manifest、schema、source 及所需 files/assets。模板创建先读 `guide({topic:"templates"})` 和 `guide({topic:"template-extraction"})`，维护严格 README、四阶段指南及可选组件库，用 `template_save` 保存并在实际 Page 验证，不把一个实例的固定大纲写成所有任务的规则。

完成后对照读者简报和设计稿核对源内容、数字、来源、布局、窄屏与主要交互。按实际宿主规则检查图像及交互，未执行真人试读不声称理解效果已验证。保存后 `page_present`；远程连接单独核对 synchronization，不把保存或展示成功当作云端同步成功。

## Kimi Widget 与文件交付

先确认当前宿主确有 Widget 能力并读取它的工作区与显示契约。使用 MCP 返回的真实文件路径：读取 `delivery.inline`，把文件完整复制到该 Widget 的 `workspace/index.html`，保留字节内容并执行宿主显示动作。不要逐字重写大段 HTML。Widget 的显示路径以本次宿主说明为准，不猜固定的用户目录。

对话 Widget 使用离线阅读器。完整页面需要时按当前 schema 调用 `page_export`，传 projectId、pageId、`format:"inline"`、`components:"bundled"`、`reader:"bundled"`，必填的 out 使用宿主提供的导出路径；检查最终压缩字节是否满足宿主限制（当前约 1 MB），并确认没有超限自动切成在线阅读器。`delivery.compact` 和 `delivery.online` 依赖联网，不能用于阻止远程请求的 Widget。超限时交付完整离线 `format:"html",components:"bundled",reader:"bundled"` 文件，或按明确 blockIds 导出选区；保留一份完整源 Page。

`page_present({projectId,pageId,blockIds?})` 的 blockIds 只选择 inline 预览，完整 HTML/source 仍保留全页。需要局部离线文件时 `page_export` 显式带相同选区。更新展示复用已有 Widget 入口。用户明确只要独立文件且不入库时才用 `render_document`，同样核对离线交付。用户要求只保存或后台运行时按指定结果完成。

没有 Widget 时交付页面身份与完整 HTML 文件/下载链接，不伪造显示，不使用 Codex 专用引用语法。交付分别说明已保存、已同步、已显示与未验证范围；原始材料与完整历史始终保留。

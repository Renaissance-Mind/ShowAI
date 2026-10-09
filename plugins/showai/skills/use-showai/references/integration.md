# 跨宿主统一流程

所有 Agent 使用同一套 ShowAI MCP 文档操作。入口由宿主配置，Agent不在 CLI 与 MCP之间自行选择。CLI保留启动、诊断、脚本与管理用途。缺少连接时按 [连接配置](runtime.md) 处理。

## 项目操作

1. `showai_capabilities` 检查真实能力。
2. `project_context` / `projects_list` 核对连接与项目。本机 library连接的新正式内容用 `project_resolve({sourceDirectory})` 解析可信宿主目录；绑定和远程连接不提供这个动作。
3. `page_read` 取得完整内容与 hash/revision，或 `page_create` 创建源页面。
4. `page_apply` / `page_save` 提交变更，检查保存及同步回执。
5. 需要展示时 `page_present({projectId,pageId,blockIds?})`，依据宿主能力交付。

正式内容默认保存到已选项目。用户明确只要独立结果时，查询 `public_catalog_list/describe`，使用 `render_document`；它不保存个人项目，persistence 明确返回 false。连接或保存失败不能自动触发这条独立路径。

## 相同工具，不同连接范围

本机 library连接允许选择已存在项目，或按用户任务解析、创建项目。项目绑定连接只允许固定项目；传其他 ID 会失败。远程连接只允许 OAuth已授权且仍有成员权限的项目。显式传 projectId，不能从其他连接照搬 ID。账号管理、连接配置与发布管理不属于普通文档工具的权限。

本机和远程均用 `component_save` 传可编辑源码对象、`template_save` 传模板定义。不要让普通组件创作依赖远程无法访问的本机文件路径。服务端实际工具列表与 inputSchema 才是能力证据；缺少操作时说明限制。

## 展示与同步

| 实际宿主能力 | 展示方式 |
| --- | --- |
| MCP Apps | 使用工具附带的阅读器资源与结果 |
| Codex本机 HTML 可视化 | 用返回的 delivery.inline 文件路径生成宿主引用 |
| 浏览器 / 文件预览 | 打开完整 HTML文件或下载链接 |
| 无内嵌显示 | 交付项目、页面、版本与同步结果；需要文件时交付链接 |

page_present 的 blockIds只限制 inline预览，完整 HTML/source保留整个页面。page_export是明确文件导出的低层工具，其选区源码本身可以是局部；不得拿它覆盖整页。显示成功、保存成功与同步成功分别核实。

远程项目操作执行授权副本的拉取、操作和推送。检查 isError、ok及 synchronization.state；本机已保存而远端同步失败时，保留内容并报告失败。HTTP交付链接有有效期，本机交付路径由宿主/运行时分配。输出目录不是正式内容的归属证据。

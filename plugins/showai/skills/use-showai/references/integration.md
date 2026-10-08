# 跨宿主接入：展示与同步分别选择

ShowAI 的内容、组件、模板和操作规则在不同 harness 中共用。先确认能调用哪一种入口，再分别确定展示方式和内容归属。不要从 Codex、ChatGPT、Claude、pi、dsh 等名字推断工具或显示能力。

## 发现入口

已连接 ShowAI MCP 时，先调用该连接的 showai_capabilities。工具可能带宿主分配的前缀，以当前实际暴露的工具为准。读取 transport、presentation、projects.available 和 next。MCP 可调用不代表宿主能够显示 MCP Apps 或 HTML。

有本地命令执行能力时，按 [运行入口](runtime.md) 取得 CLI，再查 runtime info 的 capabilities。缺少字段时查询所需 guide；不能把插件里的新说明当作旧软件已经支持。只有远程 MCP 时，使用返回的工具和 ID，不查询本机 `~/.showai`、不传本机路径、不要求安装桌面软件。两种入口都没有时，说明缺少的连接信息。

## 两个独立维度

| 展示 | 存储与同步 | 交付 |
| --- | --- | --- |
| 支持 inline / MCP Apps | 不同步 | 用公共组件、模板或自定义源码制作本轮展示；提供 HTML 与源文件。 |
| 支持 inline / MCP Apps | 共享项目 | 修改已授权项目，核对保存和同步，再按需要展示同一页面。 |
| 不支持 inline | 不同步 | 交付 HTML/源文件；写入同机内容库时，用户可以在 ShowAI 打开。 |
| 不支持 inline | 共享项目 | 直接读写项目并检查同步回执；用户在自己的 ShowAI 看结果。写入无需生成 HTML。 |

公共资源与定制无需个人服务器登录。只展示本轮内容时，可采用独立渲染；需要持续编辑的本地页面时保存到明确项目。同步依据用户选择的项目连接，独立于展示方式。

## 操作映射

| 任务 | CLI | MCP |
| --- | --- | --- |
| 公共目录 | `public list`、`public describe ID --view guide/schema/examples/source` | public_catalog_list、public_catalog_describe |
| 独立展示 | `render --input INPUT_JSON --out /OUTPUT/page.html --json` | render_document |
| 应用公开模板 | `render --template TEMPLATE_ID --out /OUTPUT/page.html --json` | render_document 的 templateId；定制时先读模板 source，再传 document |
| 取回独立展示源码 | 读取 delivery.source 文件 | HTTP 下载受限时用 presentation_source(artifactId)，按 offset/nextOffset 顺序拼接 text 后解析 JSON |
| 确定项目 | projects list/current | HTTP：projects_list；绑定项目的 stdio：project_context |
| 页面读写 | pages list/read/create/save/apply | pages_list、page_read/create/save/apply |
| 目录与定制 | catalog list/describe/save、template save/apply | catalog_list/describe、component_save、template_save/apply |
| 展示已有页面 | export --format inline/html | HTTP：page_present；stdio：page_export |
| 同步核对 | sync run --project PROJECT、sync status | stdio：project_sync/project_sync_status；HTTP 项目调用返回 synchronization，检查 state/error/remoteHead |

render / render_document 输入为 `{document?, templateId?, title?, componentSources?, blockIds?}`，document 与 templateId 二选一。组件源码对象含 manifest、schema、source、可选 files/assets，与 component_save.source 格式一致。页面中的自定义组件用 attrs.kind=custom，attrs.data={componentId,version,props} 引用；不能把组件 ID 当作内置 kind。使用本轮真实材料；模板填写提示不是业务事实。

独立渲染返回 savedToProject=false、synchronized=false，不声称已存入个人项目。CLI 返回本机 HTML、inline、源文件路径；HTTP 返回有期限的下载地址，并给支持 MCP Apps 的宿主附带阅读器。inline 超限时保留完整 HTML/源文件并返回 inlineError；用源 document 中的 blockIds 选择小范围重新渲染。到期后重新渲染。长期保存通过源文件或用户选择的项目完成。

## 共享项目与权限

HTTP 私有工具通过 OAuth 登录已配置的 ShowAI Server，由用户选择项目与权限；公共展示跳过登录。每次项目调用显式传 projects_list 返回的 projectId，不照搬本机目录或其他连接的 ID。

网关在项目操作前同步当前内容，写入后再次同步，并检查真实服务器成员权限。同时核对 isError、ok 和 synchronization.state=synced。本机副本已写入而同步失败时，明确报告远程同步未完成并保留内容。

写入沿用当前 hash、revision 和节点 ID。同设备过期保存失败后读取、比较并明确处理；跨设备冲突可能保留双方副本并返回新的 document.id，按真实回执继续。模型自报的 harness/session 只用于来源说明，不决定权限。

无 inline 的宿主可完成全部项目操作，交付项目、页面标题/ID、修改摘要和同步结果即可。同步传递内容与版本，不自动传递全部聊天记录。

## 宿主显示与配置

显示按 [对话展示](../../show-document/references/conversation-display.md) 的实际协议执行。文件导出成功不等于已显示；不得把 Codex 引用语法发给其他 harness。

`showai mcp --project PROJECT` 提供绑定项目的本地工具；`showai mcp --public` 仅提供公共目录与独立展示，不选择个人项目。远程入口由部署者运行 `showai mcp serve`。部署与 HTTPS 配置是一次性的连接工作，不是每次创作都要启动服务。

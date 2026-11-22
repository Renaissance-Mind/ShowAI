# 跨宿主 Agent 接入

**语言：** [English](../agent-integration.md) | 简体中文 · [文档目录](index.zh-CN.md)

所有宿主都通过 MCP 操作 ShowAI。聊天可视化直接从 `show-visual` 开始，默认用原创 HTML 展示，项目归属和其他工作流从 `use-showai` 开始。本机专用插件随 Skills 提供 stdio 启动配置。通用插件使用宿主里手动添加的本机 stdio 或可达的 HTTP MCP 连接。

正式内容先保存到项目，再按宿主适配交付。明确要求独立文件时使用 render_document。本机 library 连接每次携带 projectId，只读发现用 projects_list，新正式内容可用 project_resolve 与可信宿主绝对目录定位。绑定项目连接沿用其身份。

## 连接、展示与同步

支持 MCP 不代表支持 HTML 显示。兼容宿主可显示 MCP Apps/inline，纯文本宿主仍可保存项目、返回同步回执与文件链接。公共独立渲染、私有项目读写、实际显示分别核对。

本机运行时见「设置 → MCP」中的「本机运行时」与「本机启动配置」，或所选内容库的 agent-runtime.json。下面 showai 代表核实后的命令前缀：

```sh
showai runtime info --json
showai guide integration --json
showai public list --kind component --view compact --json
showai public describe chart --view schema --json
showai render --input presentation.json --out /absolute/output/page.html --json
showai mcp --public
showai mcp --project PROJECT_ID
```

公共渲染输入可含 document 或 templateId，以及 title/componentSources/blockIds。自定义组件使用 manifest/schema/source 与可选 files/assets，节点 kind 为 custom；不认识的 widget 不会变成可执行组件。编译在隔离临时目录完成并清理，回执明确 savedToProject:false、synchronized:false。

library MCP 增加 projects_list/project_resolve/project_create；绑定项目连接也可查询公共资源。--public 仅提供公共查询、指南与渲染。私有项目渲染位置在 local/agent-previews 等非同步区域。项目同步使用 project_sync/project_sync_status；明确项目的同步只处理该项目。

## T3 Code

T3 在线程所在的环境加载提供方的 MCP 配置。共用配置目录的 Codex、Claude Code 可以直接复用已有 ShowAI 插件。独立配置目录可在 ShowAI「设置 → Agent 插件 → T3 Code」选择 Codex TOML、Claude CLI、OpenCode 或 MCP JSON，在目标机器应用后，从 T3 命令面板选择 **重启智能体会话**。

T3 Code 0.1.11 的 Codex 和 Claude Code 2.1.301 及以上支持交互式 MCP App。其他提供方可传 `delivery:"t3-html"`，用 T3 的 `html_preview` 检查返回的路径或 HTML，再用 `html_render` 放进对话。读者点击本机 MCP App 卡片并确认后，运行连接的电脑会在 ShowAI 桌面 App 中打开原页或指定组件。纯 HTML 卡片提供可复制的 ShowAI 链接。用户明确选择 T3 浏览器时，本机 `workbench_page_url` 和 `workbench_url` 接受 `surface:"t3-code"`，返回线程执行环境的端口目标，每个原页可独立占用一个宿主标签。[T3 展示协议](https://github.com/pingdotgg/t3code/blob/v0.1.11/docs/user/html-renders.md)

## 远程 MCP 服务

桌面 App 在「设置 → 远程 MCP」提供局域网 HTTP 与访问密钥、Tailscale Serve 私网，以及 Cloudflare 或 Tailscale Funnel 公网连接。HTTPS 连接通过 OAuth 和桌面确认授权；所有模式直接保存本机内容。逐步操作见[设备与客户端接入](chatgpt.zh-CN.md)。下文的 `mcp serve` 是连接同步服务器的托管网关；仅传 `--home` 不会开放该库的私有项目。

MCP 网关独立于内容同步服务器。它使用已安装运行时的 Node、编译器与阅读器，内容服务器只保存快照和对象。

```sh
showai mcp serve \
  --state /absolute/private/showai-agent-state \
  --host 127.0.0.1 --port 8789 \
  --public-url https://agent.example.com \
  --sync-server https://content.example.com
```

使用稳定 HTTPS 代理，MCP 地址为 /mcp，/health 返回就绪状态。--sync-server 支持逗号分隔的受信任服务器基址及 /cloud 前缀。未配置服务器仍可公共渲染。授权选择一个指定项目，或该账号当前与未来可访问项目；每个服务器账号独立连接。

--state 保存私有 OAuth 数据和每份 grant 的项目副本，仅服务账号可访问。反向代理保留公共 Host；公开提交可用 --widget-domain 声明 UI origin。loopback 开发可用 HTTP，发布需 HTTPS。

### Cloudflare

配置 deployments/cloudflare/mcp.wrangler.jsonc，用 Worker/Durable Object 转发到 Node Container。构建入口 build:cloud-mcp 包含编译器与阅读器。状态以独立 SHOWAI_MCP_STATE_KEY 加密并在请求确认前检查点到私有 R2；新容器恢复核验后服务。预览的一小时有效期跨重启保留。

检查点失败不能返回成功。原状态密钥必须备份并在更新时保留；没有自动回收未引用加密块。构建或 dry-run 不证明生产、登录或 ChatGPT 交互通过，见 [部署指南](cloud-mcp-deployment.zh-CN.md)。

## 工具与授权

在聊天里做可视化时，用 show-visual 编写原创 HTML，直接调用 `show_component({html})`。多幅图按顺序传入数组，每次最多五幅。用户明确要求使用现有 ShowAI 组件时才查询目录，已知 ID 可直接读使用说明。需要核对宿主显示方式时用 `showai_capabilities({view:"presentation"})`。

| 客户端 | 展示工具的加载方式 |
| --- | --- |
| Claude Code | 服务端用 `_meta["anthropic/alwaysLoad"]` 标记 `show_component`，用户显式设置具有优先权。[工具加载说明](https://code.claude.com/docs/en/mcp#mark-a-tool-to-load-upfront-or-stay-deferred) |
| Antigravity | 安装包在 `mcp_config.json` 为 `show_component` 声明 eager。[预加载说明](https://antigravity.google/docs/mcp#configure-eager-tools) |
| Codex | 当前可见时直接调用。开启工具搜索时，在一次查询里给出所需工具名。 |
| Kimi Work | 直接使用已注册的工具。如果会话提供 `select_tools`，可一次选取需要的工具。 |
| DeepSeek Harness | 自带的 MCP 客户端在连接时注册工具。本机图形界面支持对话内预览、右侧会话标签页编辑并引用到草稿、左侧导航打开全局工作台。 |
| ChatGPT MCP Apps 及其他 HTTP 客户端 | 服务通过 `tools/list` 提供相同的工具声明，加载与显示由客户端控制。未安装 Skill 的客户端可按工具描述执行。 |

ShowAI 内置 Agent 在制作页面或用户指定已有组件时按需查询索引。聊天里的原创 HTML 可直接展示，文字界面可交付本机预览回执中的文件。

托管 HTTP 可匿名调用的工具包括 showai_capabilities、public_catalog_list/describe、render_document、show_component、presentation_source。presentation_source 分块取回公共渲染输入，不公开私有页面导出。匿名调用不会读取个人内容库。

HTTP 私有工具沿用项目操作名，显式传 projectId 并检查 OAuth。projects_list 每次读取当前成员权限。项目范围 grant 仅允许原项目；账号范围包含后续项目。project_create 还需 projects.create，创建并同步后返回服务器 ID；同一 operationId UUID 用于同一请求重试。

每次私有操作验证 token、授权项目、scope 与实时角色，在副本内串行拉取→操作→推送。历史标记为外部 MCP 客户端。响应给出 synchronization.state/error/remoteHead；副本保存但推送失败会返回失败并保留恢复数据。跨设备冲突保留来源副本，应采用返回的实际页面 ID；同设备旧写入仍需处理冲突。

本机路径导入、整站发布和本地恢复留在本机。远程组件通过 component_save 传源码；导出使用服务分配路径并返回临时下载链接。

OAuth 提供发现、DCR、S256 PKCE、resource 绑定、过期访问 token、轮换刷新、授权与撤销。授权流程登录既有 ShowAI 账号，不自动创建或合并。GitHub/Google 使用配置服务器的身份来源：新标签页完成后，把一次性完成码填回发起授权的标签页，再确认项目/账号权限。密码仅转交明确配置的服务器，不保存在网关；上游会话凭据进入私有状态以执行授权操作。

## MCP 调用日志

源码运行时将每次 `tools/call` 记录为 `started` 和 `completed` 两条 JSONL 事件。项目绑定和内容库 stdio 入口（包括内置 Agent）写入 `<内容库>/local/mcp-logs/`；公共 stdio 使用同级目录 `<内容库>.mcp-logs/`，避免初始化内容库。本地 HTTP 使用 `<内容库>/local/mcp-logs/`，托管网关写入 `<stateDirectory>/logs/mcp/`。重新构建运行时并重启 MCP 进程后生效；只安装 Skill 不会更新正在运行的代码。

统计调用次数时筛选 `event == "completed"`。记录包含 UTC 时间、传输方式、工具与 action、应用及插件版本、输入输出 JSON 字节数、毫秒耗时、状态（`success`、`error`、`cancelled`、`interrupted` 或 `transport_error`）和错误码。`callId` 关联开始与完成事件，`instanceId` 和 `sequence` 表示同一写入实例内的调用顺序。stdio 包含初始化时的客户端名称、版本及会话 ID。HTTP 是无状态入口，仅在调用方提供 `mcp-session-id` 时记录会话标识；授权调用还记录授权标识。资源、请求、操作、分组、授权和调用方提供的会话 ID 均保存为 SHA-256 摘要的前 24 位十六进制字符。只有 `started` 的记录可能表示仍在执行或进程意外退出；stdio 正常关闭会将未完成调用记为中断，收到取消通知后的失败会标为取消。HTTP 耗时包含项目同步及已配置的持久化检查点，不包含客户端接收和宿主渲染时间。

日志省略参数对象、文档与源码正文、返回正文、请求头、凭据和错误消息；元数据标签经过限长与脱敏。每个写入实例使用独立文件，单文件达到 5 MiB 时轮转，最多保留三份，避免多进程轮转冲突。首次写入及之后最多每天一次检查并清理超过 30 天未更新的日志文件。POSIX 系统的日志文件仅所有者可读写。日志 I/O 失败时每个写入实例向 stderr 提示一次，不影响工具执行。

启动运行时前设置 `SHOWAI_MCP_LOG=0` 可关闭日志，设置 `SHOWAI_MCP_LOG_DIRECTORY=/absolute/private/path` 可指定目录。日志保留在所属实例中，不会自动汇集到统一分析服务。无效 JSON、因主机名、Origin 或请求大小被拒绝的请求及非工具方法不属于调用日志的覆盖范围。

## ChatGPT 与展示宿主

接入官方服务见 [ChatGPT 网页指南](chatgpt.zh-CN.md)。MCP Apps 资源使用 text/html;profile=mcp-app、_meta.ui.resourceUri 及 ChatGPT 兼容字段。页面从工具结果元数据进入宿主沙盒，自定义组件使用 Shadow DOM 内联运行。

对话预览优先带压缩本地阅读器；超预算后可使用固定版本的在线阅读器，从 ShowAI reader 源、jsDelivr、unpkg 加载。delivery.compact 面向模型写 HTML 的宿主。reader:bundled 与 SHOWAI_READER_CDN=off 禁止在线回退；reader:cdn 明确联网。预览链接一小时到期，应保存到项目或保留源数据。纯文本宿主可以交付完整 HTML/source 和项目回执。

下载[通用插件 ZIP](https://raw.githubusercontent.com/Renaissance-Mind/ShowAI/main/downloads/showai-universal.zip)，或在源码目录运行 `npm run package:plugin -- --out showai-universal.zip` 生成安装包。安装六个 Skills 后，在宿主配置 MCP。ChatGPT Personal 插件可引用已经注册的连接。`--mcp-url` 将手动连接地址写入插件说明。见[各宿主安装说明](../../plugins/showai/README.zh-CN.md)。

## 已保存页面的展示约定

从 Antigravity 的辅助面板或 DeepSeek Harness 的会话右侧栏打开原页时，ShowAI 显示单页编辑器和页面操作，外层标签由宿主管理。在两个宿主的全局 ShowAI 入口都可浏览项目和使用 ShowAI 工作区标签。

从 ShowAI「设置 → Agent 插件」安装或更新 Codex 插件。临时图表和组件用 `show_component` 在聊天里交互展示。当前连接提供 `card_present` 时，新建或编辑页面并保存成功后，默认在同一轮交付原页卡片。传入已保存页面的 `projectId` 和 `pageId`，卡片会显示标题及完整路径。可用 `description` 简述新内容或本次改动，最多 1000 个字符。要指向某个组件，再传入保存后大纲里的 `blockId`。明确要求在对话里阅读正文时使用 `page_present`。

一次发多张时，首张照常传参，其余目标按顺序放入同一次调用的 `additionalTargets`。每张卡片都可以有自己的组件和说明。在 Codex 点击卡片本身，即可在聊天右侧打开原页，已有同页标签时直接跳转。Agent 主动跳转时可先调用 `card_navigate`，返回 `unavailable` 时再调 `card_open`。Qoder 的卡片可定位已打开的 ShowAI 侧栏编辑器，`card_open` 可打开新的任务侧栏标签。Cursor IDE 安装 VSIX 后可使用原生工作台和 `.showai-ref` 文件编辑入口。使用浏览器的卡片会提供原页编辑链接。详见[宿主安装与交付指南](../../plugins/showai/README.zh-CN.md#cursorqoder-和-workbuddy)。

`page_present({projectId,pageId,blockIds?})` 捕获一个源版本，返回身份/hash/revision，不修改 Page。HTML/source 始终完整；blockIds 只选择 inline 预览。临时构建失败会清理中间目录。

本机输出使用 SHOWAI_PRESENTATION_DIR 或预览目录；HTTP 返回过期下载链接。匿名 presentation_source 无法读取私有源。本机呈现 synchronization.state:not_checked，不主动同步；HTTP 返回实际同步回执。page_export 的局部导出则连同源 JSON 都是局部内容。

本机 launcher 只探测所选库的注册运行时与 showai-mcp-v1，失败明确报错。内置 AgentHost 提供项目绑定 MCP，并从任务私有插件移除 library launcher。模板阶段与参数接口见 [模板文件夹](template-bundles.zh-CN.md) 和 [组件参数](component-parameters.zh-CN.md)。

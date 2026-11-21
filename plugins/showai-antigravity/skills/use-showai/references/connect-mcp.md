# 帮用户连接 ShowAI

通用插件随包提供六个 Skills。MCP 连接由用户在当前宿主中单独添加和授权。ChatGPT Personal 可引用已经手动注册的连接。Codex、Claude Code、Antigravity、Kimi Work 和 DeepSeek Harness 的本机专用包同时提供 Skills 和 MCP 启动配置。

## 先判断当前状态

1. 查看当前会话实际提供的 ShowAI 工具，必要时用宿主的工具发现查找。已有可用连接就继续原任务。显示声明不明时可读 `showai_capabilities({view:"presentation"})`。只收到 `showai_connection_problem` 时先读它的诊断。
2. 已配置但显示「未连接」、`USER_NOT_LOGGED_IN` 或 OAuth 过期时，让用户打开原连接并重新连接或授权，刷新会话后重试。端点和传输方式匹配时复用已有配置。工具存在但项目被拒绝时检查项目授权。
3. 缺少工具且安装的是本机专用包，先检查插件是否启用、所选内容库的运行时是否已登记，按[本机诊断](runtime.md#本机插件)处理。用户选择通用插件，或宿主没有专用插件时，按下面的向导继续。

## 一次问一个问题

从宿主标识、用户已说的环境和连接状态开始。只问会影响下一步的未知条件，得到答复再给对应操作。用户没有提供地址时，先带他找到「复制 MCP 地址」或「复制接入提示词」。地址、登录和项目权限分别核实。由用户在宿主的凭据输入框填写密钥，在 ShowAI 核对客户端与权限后批准。

### ChatGPT 网页

- 已识别为 ChatGPT 云端时，直接问「你已经有 ShowAI 的公网 HTTPS MCP 地址了吗？」已有地址就进入注册；还没有则请用户在运行 ShowAI 的电脑打开「设置 → 远程连接 → 公网入口」。
- 临时试用可选 Cloudflare 临时域名。长期使用可配置 Cloudflare 固定域名，或已开通的 Tailscale **Funnel** 公网入口。保持电脑在线、ShowAI 运行，在 App 检查通过后复制以 `/mcp` 结尾的 HTTPS 地址。ChatGPT 的云端无法直连用户的 localhost、家庭局域网或仅 tailnet 可达的 Serve 地址。
- 在 [ChatGPT 插件设置](https://chatgpt.com/plugins) 点击加号 → Add custom MCP server，选 Server URL，填写地址，选择 OAuth 和动态客户端注册（DCR），再点 Create as a plugin。要求开发者模式时在设置中启用；受组织管理时由有权限的管理员添加。打开连接，在 ShowAI 对照连接编号批准，再返回 ChatGPT 完成授权。用户已经注册过服务时从原条目继续。
- 导入通用 Skills 后即可复用宿主提供的工具。希望把 Skills 明确关联到这个 ChatGPT 连接时，在 ShowAI 的对应公网入口选择 ChatGPT，使用「导出 ChatGPT 插件」并填写已注册连接的插件页链接，再按宿主支持的方式导入 ShowAI Personal。

### Grok Bot

- 先问「运行 Grok Bot 连接器的设备，与运行 ShowAI 的电脑在同一个 Tailscale 私网吗？」以实际运行连接器的设备为准。若两种网络都可用，让用户选择私网或公网。
- **同一 tailnet**：在两端登录同一 tailnet，确认访问规则允许连接，并启用 MagicDNS 和 HTTPS。在 ShowAI「设置 → 远程连接 → Tailscale 私网」开启 Serve，选择「设备授权」，复制接入提示词。在 Grok Bot 的 Add MCP server 中使用 **Command / stdio**，填提示词给出的 `mcp-remote` 命令；支持直接 HTTP 的入口也可填私网 HTTPS 地址。由用户在 ShowAI 批准核实过的 Tailscale 设备。选择私网 OAuth 时按 App 给出的 OAuth 配置操作。
- **公网**：请用户在 ShowAI 开启一个公网 HTTPS 入口并复制地址。若 Grok 的 MCP 设置支持 HTTP 和 OAuth，填入该地址并完成授权；只有 Command / stdio 时，用 `npx -y mcp-remote@0.16.6 <公网HTTPS地址/mcp> --transport http-only` 连接。OAuth 需要在能接收该桥接进程回调的设备上完成。若回调失败，指出需要支持该回调的客户端。私网可用时可选设备授权；用户已明确只能走公网时继续处理公网 OAuth。

### 其他 Agent

先问「MCP 客户端运行在 ShowAI 这台电脑、同一网络的另一台设备，还是云端？」再看该宿主接受远程 URL 还是本机命令。

| 位置 | 手动配置 |
| --- | --- |
| 与 ShowAI 同机，支持 stdio | 从 ShowAI「设置 → 插件 → 手动添加 MCP」复制真实启动配置，在宿主的 MCP 设置里填写命令、参数和环境，使用选定的内容库。 |
| 同一可信局域网 | 在 ShowAI 启用局域网连接，填入显示的 Streamable HTTP 地址，在客户端凭据设置中填写 ShowAI 的访问密钥。只接受 HTTPS 的客户端改走 Tailscale 或公网。 |
| 同一 tailnet | 使用上面的 Tailscale 私网路径。能填 URL 的客户端直接使用 HTTPS；只支持 stdio 的客户端用 App 提示词中的桥接命令。 |
| 云端或跨网络 | 使用客户端可达的公网 HTTPS 与 OAuth。仅支持 stdio 时先确认运行桥接命令的设备能访问该地址并完成 OAuth。 |

只支持 Command / stdio 且只有可信局域网 HTTP 时，可将 App 创建的访问密钥在连接器设备上存为仅自己可读的请求头文件，内容为一行 `Authorization: Bearer <密钥>`。命令用 `npx`，参数依次为 `-y`、`mcp-remote@0.16.6`、App 的实际 HTTP MCP 地址、`--allow-http`、`--transport`、`http-only`、`--header-file`、该文件的本机绝对路径。若宿主无法安全提供请求头，说明缺少的能力。

## 怎样确认成功

在配置的**同一个客户端**刷新工具并试一次只读调用。公共展示可用 `public_catalog_list({kind:"component",view:"compact"})`；用户要访问自己的项目时调用 `projects_list`。空列表也是成功响应，说明当前可见项目为零；公开目录成功只验证公共访问。授权不足、地址失效、设备待批准、工具仍未加载时，说明实际状态，回到对应一步。确认连通后继续用户原先的任务。

临时公网地址变化或收不到批准弹窗时，按[远程连接排查](runtime.md#远程)检查当前地址、App 在线状态与授权请求。客户端支持 MCP Apps 时可呈现交互视图；只提供文本输出时给出工具结果及可访问的页面或文件链接。连接与呈现分别以实际回执为准。

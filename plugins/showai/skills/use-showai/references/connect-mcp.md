# 帮用户连接 ShowAI

通用插件随包提供六个 Skills。使用随包提供或宿主已配置的 ShowAI MCP。ChatGPT Personal 可引用已经注册的连接。Codex、Claude Code、Antigravity、Kimi Work 和 DeepSeek Harness 的本机专用包同时提供 Skills 和 MCP 启动配置。Cursor、Qoder 和 WorkBuddy 也可生成各自的本机插件包，附上选定内容库的 MCP 启动配置。

## 先判断当前状态

T3 Code 在线程所在的环境加载提供方配置。同一 Codex 或 Claude Code 配置目录可复用已安装的 ShowAI 插件。独立目录在 ShowAI「设置 → Agent 插件 → T3 Code」选择提供方，按其配置格式接入，再在 T3 命令面板选择「重启智能体会话」。展示和原页编辑见 [T3 Code](host-display.md#t3-code)。

1. 先判断当前任务是否需要 ShowAI MCP。需要时查看当前会话实际提供的 ShowAI 工具，必要时用宿主的工具发现查找。已有可用连接就继续原任务。显示声明不明时可读 `showai_capabilities({view:"presentation"})`。只收到 `showai_connection_problem` 时先读它的诊断。
2. 已配置但显示「未连接」、`USER_NOT_LOGGED_IN` 或 OAuth 过期时，让用户打开原连接并重新连接或授权，刷新会话后重试。端点和传输方式匹配时复用已有配置。工具存在但项目被拒绝时检查项目授权。
3. 缺少工具且安装的是本机专用包，先检查插件是否启用、所选内容库的运行时是否已登记，按[本机诊断](runtime.md#本机插件)处理。用户选择通用插件，或宿主没有专用插件时，按下面的向导继续。

## 一次问一个问题

任务需要 MCP、当前工具不可用且配置缺少必要信息时，根据宿主、用户已说的环境和连接状态，只问会影响下一步的一个未知条件。用户需要手动设置地址时，引导他在 ShowAI 中找到「复制 MCP 地址」或「复制接入提示词」。地址、登录和项目权限分别核实。由用户在宿主的凭据输入框填写密钥，在 ShowAI 核对客户端与权限后批准。

### ChatGPT 网页

ChatGPT 网页从云端连接，需要公网地址。在客户端步骤选择 ChatGPT，依次填写服务器、OAuth 和连接确认；其他客户端直接使用通用接入步骤。通用 Skills 包可在连接前导入。需要将 Skills 明确关联到 ChatGPT 已注册的连接时，把该连接的插件页链接交给 App，导出 ShowAI Personal ZIP。绑定会保存，后续无需重复填写；仅含 HTTP MCP 声明的 ZIP 在 ChatGPT 中可能仅桌面可用，不能把导入成功当作网页可用。导入完整插件后使用关联连接。客户端授权页显示等待本机确认，用户回到 ShowAI 核对连接编号并点击允许，网页自动完成 OAuth。用户可在该连接的「客户端」中单独撤销一个已授权的 OAuth 客户端。连接请求会在 ShowAI 工作台弹窗显示，无需先进入设置。请求十分钟有效；服务重启会取消尚未完成的请求，但保留已有有效授权。旧授权窗口失效时，无需重新安装插件：回 ChatGPT 打开该插件，重新点击连接，在 ShowAI 确认新请求。没有弹窗时先确认设备上的 App 已运行且版本支持本机确认，查看「设置 → 远程 MCP」的状态；不要让模型代为批准。旧版本仍可能使用一次性配对码；模型不代替用户批准连接，不索取、读取或转述配对码、隧道令牌。保存直接进入本机内容库，persistence.storage:local 不表示已同步到云端。远程客户端不能传本机文件路径。电脑需要保持联网、唤醒且 App 运行；已经启用的连接会随 App 启动恢复，主动断开后不会自动恢复。Quick 地址重新连接后变化，需要更新客户端地址或重新导出插件。实际接入成功以所选地址的检查和客户端真实调用为依据。

- 需要新建连接且公网地址未知时，问「你已经有 ShowAI 的公网 HTTPS MCP 地址了吗？」已有地址就进入注册；还没有则请用户在运行 ShowAI 的电脑打开「设置 → 远程 MCP → 公网入口」。
- 临时试用可选 Cloudflare 临时域名。长期使用可配置 Cloudflare 固定域名，或已开通的 Tailscale **Funnel** 公网入口。保持电脑在线、ShowAI 运行，在 App 检查通过后复制以 `/mcp` 结尾的 HTTPS 地址。ChatGPT 的云端无法直连用户的 localhost、家庭局域网或仅 tailnet 可达的 Serve 地址。
- 在 [ChatGPT 插件设置](https://chatgpt.com/plugins) 点击加号 → Add custom MCP server，选 Server URL，填写地址，选择 OAuth 和动态客户端注册（DCR），再点 Create as a plugin。要求开发者模式时在设置中启用；受组织管理时由有权限的管理员添加。打开连接，在 ShowAI 对照连接编号批准，再返回 ChatGPT 完成授权。用户已经注册过服务时从原条目继续。
- 连接已授权且工具已加载时，通用 Skills 可复用该连接。希望把 Skills 明确关联到这个 ChatGPT 连接时，在 ShowAI 的对应公网入口选择 ChatGPT，使用「导出 ChatGPT 插件」并填写已注册连接的插件页链接，再按宿主支持的方式导入 ShowAI Personal。

### Grok Bot

能够配置 MCP 的 Agent 可以使用「设置 → 远程 MCP」为当前连接生成的「复制接入提示词」。Tailscale 私网的「设备授权」模式要求 Agent 所在设备能访问对应的 tailnet。Grok Bot 按提示词添加 Command / stdio 连接「ShowAI 私网直连」，在 Grok 的 Tailscale 设备上运行其中的 mcp-remote 命令，访问同一个私网 HTTPS 地址。核对已有连接时同时匹配地址与传输方式。其他支持远程 HTTP 的客户端直接注册 Streamable HTTP，认证字段留空。ShowAI 向用户显示由 Tailscale 核实的设备和所属账号，用户在 App 允许一次，同一设备上的 Agent 共用所选项目权限。「客户端」可撤销整台设备的权限。Agent 等待批准后使用同一连接实际调用 projects_list。

- 先问「运行 Grok Bot 连接器的设备，与运行 ShowAI 的电脑在同一个 Tailscale 私网吗？」以实际运行连接器的设备为准。若两种网络都可用，让用户选择私网或公网。
- **同一 tailnet**：在两端登录同一 tailnet，确认访问规则允许连接，并启用 MagicDNS 和 HTTPS。在 ShowAI「设置 → 远程 MCP → 局域网与私网 → Tailscale 私网」开启 Serve，选择「设备授权」，复制接入提示词。在 Grok Bot 的 Add MCP server 中使用 **Command / stdio**，填提示词给出的 `mcp-remote` 命令；支持直接 HTTP 的入口也可填私网 HTTPS 地址。由用户在 ShowAI 批准核实过的 Tailscale 设备。选择私网 OAuth 时按 App 给出的 OAuth 配置操作。
- **公网**：请用户在 ShowAI 开启一个公网 HTTPS 入口并复制地址。若 Grok 的 MCP 设置支持 HTTP 和 OAuth，填入该地址并完成授权；只有 Command / stdio 时，用 `npx -y mcp-remote@0.16.6 <公网HTTPS地址/mcp> --transport http-only` 连接。OAuth 需要在能接收该桥接进程回调的设备上完成。若回调失败，指出需要支持该回调的客户端。私网可用时可选设备授权；用户已明确只能走公网时继续处理公网 OAuth。

### 其他 Agent

桌面 App 和本机浏览器版都可在「设置 → Agent 插件」给 Codex 或 Claude Code 安装插件，该页同时显示「当前登记的运行时」与各插件连接的内容库。先安装目标宿主及其可用的插件管理 CLI；macOS 也会检测常见 Codex App 位置的内置 CLI。App 复制自带插件，以 App 可执行文件启动 launcher，无需 ShowAI 源码或单独安装 Node.js。安装器检查文件与启用状态，但宿主能力刷新和会话加载仍需分别确认。已有其他来源的 ShowAI 插件时，先在宿主中停用原插件，再安装 App 版本。此入口生成的连接绑定安装时的内容库。继续旧项目时，先确认项目实际所在的库；只有需要重新绑定目标库或移动了 App，才在 App 选定目标库后「更新并启用」，再刷新或重启宿主。外部宿主连接时启动 stdio MCP，App 窗口关闭后仍可使用，App 文件必须保留。

同机使用 DeepSeek Harness 专用包时，首次打开一次 Harness 并完全退出，在 ShowAI「设置 → Agent 插件 → DeepSeek Harness」点「安装插件」，再打开 Harness。切库时可先完全退出 Harness，在 ShowAI 选定新库后点「更新并启用」，再打开 Harness。

其他本机客户端可从宿主设置检查连接。Qoder 在「扩展 → 插件」检查插件是否启用，在「扩展 → 连接器」看 ShowAI 的连接状态，含本机配置的 ZIP 会带 `.mcp.json`。WorkBuddy 本机插件先检查插件是否启用，并在新任务确认工具可用；手动连接在「连接器 → 自定义连接器」检查或添加。Cursor 在「Customize → MCPs」管理连接。修复后在同一客户端刷新并验证工具，必要时新建本机对话。连通后沿用原任务的项目和材料。

运行位置仍不明确时，先问「MCP 客户端运行在 ShowAI 这台电脑、同一网络的另一台设备，还是云端？」再看该宿主接受远程 URL 还是本机命令。

| 位置 | 手动配置 |
| --- | --- |
| 与 ShowAI 同机，支持 stdio | 在 ShowAI「设置 → Agent 插件」安装对应插件，或按源码包说明为宿主配置本机 MCP 启动命令与选定内容库路径。 |
| 同一可信局域网 | 在 ShowAI「设置 → 远程 MCP → 局域网与私网」启用局域网连接，填入显示的 Streamable HTTP 地址，在客户端凭据设置中填写 ShowAI 的访问密钥。只接受 HTTPS 的客户端改走 Tailscale 或公网。 |
| 同一 tailnet | 使用上面的 Tailscale 私网路径。能填 URL 的客户端直接使用 HTTPS；只支持 stdio 的客户端用 App 提示词中的桥接命令。 |
| 云端或跨网络 | 使用客户端可达的公网 HTTPS 与 OAuth。仅支持 stdio 时先确认运行桥接命令的设备能访问该地址并完成 OAuth。 |

只支持 Command / stdio 且只有可信局域网 HTTP 时，可将 App 创建的访问密钥在连接器设备上存为仅自己可读的请求头文件，内容为一行 `Authorization: Bearer <密钥>`。命令用 `npx`，参数依次为 `-y`、`mcp-remote@0.16.6`、App 的实际 HTTP MCP 地址、`--allow-http`、`--transport`、`http-only`、`--header-file`、该文件的本机绝对路径。若宿主无法安全提供请求头，说明缺少的能力。

## 怎样确认成功

在配置的**同一个客户端**刷新工具并试一次只读调用。公共展示可用 `public_catalog_list({kind:"component",view:"compact"})`；用户要访问自己的项目时调用 `projects_list`。空列表也是成功响应，说明当前可见项目为零；公开目录成功只验证公共访问。授权不足、地址失效、设备待批准、工具仍未加载时，说明实际状态，回到对应一步。确认连通后继续用户原先的任务。

临时公网地址变化或收不到批准弹窗时，按[远程连接排查](runtime.md#远程)检查当前地址、App 在线状态与授权请求。客户端支持 MCP Apps 时可呈现交互视图；只提供文本输出时给出工具结果及可访问的页面或文件链接。连接与呈现分别以实际回执为准。

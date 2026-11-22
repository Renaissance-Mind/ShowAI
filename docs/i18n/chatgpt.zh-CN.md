# 从其他设备和 MCP 客户端连接 ShowAI

**语言：** [English](../chatgpt.md) | 简体中文 · [文档目录](index.zh-CN.md)

在桌面 App 打开「设置 → 远程连接」，依次选择网络、开启服务、连接客户端。电脑需要保持联网、唤醒且 ShowAI 正在运行。

## 选择网络

| 模式 | 适用设备或客户端 | 连接方式 |
| --- | --- | --- |
| 同一局域网 | 同一 Wi-Fi 或以太网内的设备 | HTTP 直连与访问密钥 |
| Tailscale 私网 | 同一 tailnet 内、访问规则允许的设备 | 私网 HTTPS，按设备批准或使用 OAuth |
| 公网访问 → Cloudflare 临时连接 | ChatGPT 网页等云端客户端、网络外的设备 | 临时 HTTPS 隧道与 OAuth |
| 公网访问 → Cloudflare 固定域名 | 通过自有域名连接的公网客户端 | 自有 Cloudflare 隧道与 OAuth |
| 公网访问 → Tailscale 公网（Funnel） | 未加入 tailnet 的公网客户端 | Funnel 提供公网 HTTPS 与 OAuth |

ChatGPT 网页从云端发起请求，需要公网地址。其他设备上运行的客户端可以直接使用局域网或 Tailscale 私网。

新连接默认允许访问当前及以后新增的全部项目，并允许读取、编辑和远程新建项目。需要限制时，打开「访问规则」，选择指定项目并设置只读或完全权限。显式设置的访问规则会保留；旧版没有访问模式字段的配置采用新的全部项目默认值，旧受限客户端需要重新配对，确认新的授权范围。扩大权限时，OAuth 客户端重新授权，局域网客户端创建并填写新的访问密钥；原密钥不会自动获得更大权限。

## 建立连接

「同一局域网」中选择本机网络地址，点击「开启局域网连接」。服务只监听所选网卡。将 MCP 地址填入客户端，选择 Streamable HTTP；在 ShowAI 填写客户端名称并创建访问密钥，将密钥粘贴到客户端的 Bearer Token 字段或 `Authorization: Bearer <密钥>` 请求头。密钥只显示一次，仅保存摘要，90 天后到期，可单独撤销。HTTP 用于可信局域网；需要 HTTPS 时选择 Tailscale 私网。要求 HTTPS/OAuth 的客户端不能使用此 HTTP 模式。本机检查不证明其他设备可达，最后要完成真实客户端调用。

在「Tailscale 私网」中，两端加入同一 tailnet，开启 MagicDNS 和 HTTPS。新连接默认使用「设备授权」。打开连接后点击「复制接入提示词」，将整段发给能配置 MCP 的 Agent。Agent 用私网 HTTPS 连接，ShowAI 显示 Tailscale 核实的设备和所属账号。点击「允许连接」，Agent 就能调用获准的工具。同一设备上的 Agent 共用授权，可在「客户端」里撤销。MCP 和批准都在私网内完成。

给 Grok Bot 发送接入提示词后，它会添加「ShowAI 私网直连」。Grok 使用 Command / stdio 在自己的 Tailscale 设备上运行 `mcp-remote`，由它访问 ShowAI 私网 HTTPS 地址。Grok 提示确认添加时点确认。Mac 会复用对这台设备的授权。其他支持远程 HTTP 的客户端可以直接填写地址。

已有的 OAuth 连接保留原方式。可以在「网络 → 身份验证」选择设备授权并保存，也可以保留 OAuth。OAuth 模式使用 Tailscale Serve，客户端根据 HTTP 401 返回的地址发现授权服务。对于可信局域网，复制接入提示词会生成十分钟内有效的一次性邀请，支持设置请求头和本地凭据的 Agent 可自行配置，再由用户在 ShowAI 允许。

「公网访问」中先选择隧道。「Cloudflare 临时连接」会按需下载并校验官方连接工具，绑定可用端口并创建隧道。地址重新连接后变化，没有可用性保证；MCP 使用 JSON 响应，不依赖 SSE。

使用自己的 Cloudflare 域名时，选择「Cloudflare 固定域名」：

1. 点击「复制本机地址」，取得已经启动并保留的本机监听地址。
2. 点击「打开 Cloudflare 控制台」，创建 Cloudflared Tunnel 和发布应用路由，把 HTTP 服务指向上述地址。回到 ShowAI，点击「路由已配置，继续」。
3. 填入 HTTPS 域名和该隧道的令牌，建立连接。令牌由操作系统凭据存储加密保存，不需要账号 API Key。

固定域名优先复用上次保存的端口；端口被占用时，ShowAI 会保留另一个可用端口，并引导更新 Cloudflare 路由，不会结束占用端口的程序。临时 Cloudflare、Tailscale Serve 和 Funnel 转发程序自动分配的实际端口。配置公网地址期间，本机监听保持绑定。

「Tailscale 公网（Funnel）」要求登录 Tailscale，启用 MagicDNS、HTTPS 和 Funnel 权限。Serve 与 Funnel 从 443、8443、10000 中选择未占用的 HTTPS 端口，保留已有路由；断开时只停止本次启动的前台连接器。三个端口全部占用时显示实际错误，不覆盖其他服务。

失败时停留在连接步骤，提供重试与诊断。地址通过服务检查后才进入客户端配置，客户端实际调用成功后才显示接入完成。

## 连接其他 MCP 客户端

点击「复制接入提示词」，把整段发给 Agent。手动连接时使用界面显示的 MCP 地址和 Streamable HTTP。Tailscale 设备授权模式下认证字段留空，局域网使用访问密钥，OAuth 连接选择 OAuth。OAuth 连接由客户端发起，在 ShowAI 桌面弹窗核对连接编号并点击「允许连接」，再回客户端发送验证指令或调用 `projects_list`。确认弹窗包含客户端名称、回调地址与访问范围。请求十分钟有效；重启会取消待确认请求，保留已有有效授权。

## 连接 ChatGPT

尚未添加 MCP 时，可先从源码生成通用包或从「设置 → 外部 Agent 插件」准备插件取得六个 Skills，安装后请 Agent 带你手动连接。已有 ChatGPT 连接时，下文的 Personal 导出可引用它。

公网连接通过检查后选择「ChatGPT」，按三步填写：

1. 「服务器」：打开 ChatGPT「插件 → 添加 → 添加自定义 MCP 服务器」，填写名称、选择服务器 URL、粘贴 MCP 地址，身份验证选择 OAuth。
2. 「OAuth」：注册方法选动态客户端注册（DCR），客户端凭据自动注册，保留自动发现的权限，基础授权范围留空。发现失败时重试元数据发现；帮助弹窗可以检查服务并查看准确的 OAuth 端点。
3. 「连接确认」：创建插件后，点击「连接」或「继续连接应用」。打开 ShowAI 授权页后，在桌面 App 确认对应请求，再到插件聊天中发送验证指令。

已有插件可以重新打开并继续连接。同名时加上设备名。授权窗口失效时，在 ChatGPT 重新发起请求，再在 ShowAI 确认。

Agent 工作流使用完整的 ShowAI Skill，通过「安装完整 Skills（可选）」导出完整的 ShowAI Personal 插件。先完成上面的自定义 MCP 连接，打开其插件页面，将完整页面链接填入导出弹窗一次。ZIP 包含六个 Skills、参考文件、图标与已注册连接映射，不包含本机启动器、项目内容或凭据。在 ChatGPT 插件页面导入 ZIP；上传入口受账号与工作区策略限制，导入成功需要另外核对授权与实际调用。

页面直接保存到本机内容库，沿用版本和冲突检查。全部内容库授权自动发现后续项目；`project_create` 可以新建本机项目。创建响应不确定时，只为重试同一次创建沿用相同 operationId 与名称。另行配置的云同步需要分别核对状态。

退出 App 会关闭监听和连接器；已启用的连接会在下次启动时自动恢复，网络暂时不可用时定期重试。主动点击「断开连接」会取消自动恢复。固定域名的完整内容库授权在正常重启后保留；临时地址变化后需要更新客户端地址或重新导出插件，并重新授权。App 更新改变工具能力后，刷新客户端的 MCP 工具。保存中断时，重连后先读取 Page 再决定是否重试。预览链接一小时后过期，正式 Page 持续保存。

### 在 ChatGPT Work 编辑原页

使用桌面远程连接时，支持插件扩展的 Work 客户端可打开原页卡片、对话里的 ShowAI 面板和全局工作台。在原页卡片中打开 Page 或 Board 后可继续编辑；全局工作台会列出本次连接已授权的项目。修改保存到同一页面并沿用版本检查。只读授权只能查看。经典 ChatGPT 按会话能力显示 MCP App，可通过可用链接打开额外内容。[OpenAI 扩展支持情况](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#platform-support)

提供方参考：[Cloudflare 配置](https://developers.cloudflare.com/tunnel/get-started/)、[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)、[Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel)。独立管理的云网关见 [MCP 部署](cloud-mcp-deployment.zh-CN.md)。

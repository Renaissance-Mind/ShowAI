# 从 ChatGPT 连接本机 ShowAI

**语言：** [English](../chatgpt.md) | 简体中文 · [文档目录](index.zh-CN.md)

桌面 App 在「设置 → 远程连接」开放选定的本机项目，使用用户自己的 Cloudflare 隧道或 Tailscale 账号。页面保存在这台电脑的内容库；远程编辑沿用本机保存版本与冲突检查。电脑需要保持联网、唤醒且 ShowAI 正在运行。

## 选择连接方式

| 方式 | 用户准备 | 地址 |
| --- | --- | --- |
| Cloudflare 临时地址 | 安装 cloudflared | 自动生成 trycloudflare.com 地址，重新连接后变化 |
| Cloudflare 固定域名 | 自己的 Cloudflare 账号、域名与隧道 Token | 自己的固定 HTTPS 域名 |
| Tailscale Funnel | 安装并登录自己的 Tailscale 账号 | 设备的 ts.net 域名 |

Cloudflare Quick Tunnel 用于开发，没有可用性保证，也不支持 SSE；ShowAI HTTP MCP 使用 JSON 响应。Funnel 有提供方带宽限制。账号价格与服务可用性以提供方为准。

## Cloudflare 临时地址

1. 在远程连接中点击「下载连接工具」，App 会下载官方 cloudflared、校验 SHA-256 并保存在本机配置目录。也可以手动安装适合系统的 [cloudflared](https://developers.cloudflare.com/tunnel/downloads/)。macOS 已安装 Homebrew 时可运行 `brew install cloudflared`。
2. 打开「设置 → 远程连接」，选择「Cloudflare → 临时地址」，点击「检查工具」。检测不到时，在「连接设置」中选择程序路径。
3. 勾选项目，分别选择只读或可编辑，点击「开启连接」。
4. 等待公网检查通过，复制 MCP 地址。失败时查看具体错误；隧道建立路由后可以重新检查。

ShowAI 只启动和停止自己的前台连接器，不停止或改配用户已有的隧道。cloudflared 已有的默认配置可能影响 Quick Tunnel；遇到配置冲突时按提供方 Quick Tunnel 教程处理。

## Cloudflare 固定域名

先按上文的工具准备步骤，点击「下载连接工具」或「检查工具」，确认 cloudflared 已可运行。

1. 在自己的 [Cloudflare 控制台](https://dash.cloudflare.com/) 创建 Cloudflared Tunnel。复制该隧道的 **Tunnel Token**，不要复制账号 API Key，也不要在本机另起一个使用相同 Token 的连接器。
2. 添加 **Published application** 路由，选择自己的子域名，服务类型选 HTTP，地址填 ShowAI 显示的本机路由目标，例如 `127.0.0.1:18789`。
3. 在 ShowAI 选择「固定域名」，填写 HTTPS 域名与 Tunnel Token，选择项目并开启连接。Token 使用操作系统凭据加密保存，不会返回给 MCP 客户端。
4. 检查公网地址是否到达本次 ShowAI 实例。不要在 MCP 前加需要浏览器交互的 Cloudflare Access 登录页；客户端授权由 ShowAI OAuth 完成。

本机端口被占用时，可换一个端口并同步修改 Cloudflare 路由。参见 [Cloudflare 配置教程](https://developers.cloudflare.com/tunnel/get-started/)。

## Tailscale Funnel

1. 安装 [Tailscale](https://tailscale.com/download)，登录自己的账号，确认设备在线。
2. 按 [Funnel 官方教程](https://tailscale.com/docs/features/tailscale-funnel)启用 MagicDNS、HTTPS 和 Funnel 权限。账号所有者的批准步骤由用户本人完成。
3. 在 ShowAI 选择「Tailscale」，检查工具、勾选项目并开启连接。
4. ShowAI 用前台 Funnel 进程将公网 443 端口转发到本机 MCP。如果该端口已用于其他应用，会报告冲突而不覆盖。可使用专用设备，或由用户在 Tailscale 中处理原有路由。
5. 检查公网连接并复制 MCP 地址。设备名或 tailnet 名变化后，地址也会变化。

Funnel 的地址可从公网访问；Tailscale 成员身份不自动认证公网访问者，项目操作仍受 ShowAI OAuth 保护。

## 接入 ChatGPT 或其他 MCP 客户端

1. 打开 [ChatGPT Plugins](https://chatgpt.com/plugins)，选择 **Add custom MCP server**，粘贴包括 `/mcp` 的完整地址，选择 OAuth。账号和工作区策略决定此入口是否可用。
2. 提示客户端注册方式时选择 Dynamic Client Registration；Client ID 和 Client Secret 留空。
3. 在 ShowAI 点击「生成配对码」。在 ChatGPT 打开的 ShowAI 授权页面输入配对码，核对权限并确认授权。配对码有效期十分钟，只可使用一次，不要发送给聊天模型。
4. 安装并选择该插件，请它列出项目。ShowAI 的「最近工具调用」确认已授权的真实调用成功；仅健康检查通过不代表客户端已经连接。
5. 请 Agent 在授权项目中创建或编辑页面，源页面会直接出现在本机 ShowAI 内容库。如果另外配置了云同步，需分别核对同步状态。

支持 Streamable HTTP MCP 和 OAuth 的其他客户端可使用相同地址及配对流程；另一台电脑不需要安装隧道软件。每个客户端都有独立授权，可以在 ShowAI 中撤销。

## 权限与恢复

- 新项目不会自动授权。在 App 创建项目、勾选远程访问后，重新连接客户端以授权新项目。
- 只读项目拒绝写入，即使客户端申请了编辑范围。设备配置移除项目后，已有授权也无法再访问它。
- 修改连接方式、地址或项目权限前先关闭连接。退出 ShowAI 会停止 MCP 监听和连接器；下次启动 App 不会自动开放远程服务。
- 固定地址的 OAuth 授权在正常关闭、开启后保留；Quick 地址变化后需要更新客户端地址并重新配对。
- 工具或认证元数据变化后，在 ChatGPT 刷新自定义 MCP，再新建对话。
- 保存途中断线，恢复后先读取页面再决定是否重试，不把超时视为写入未发生。
- 预览及下载链接一小时后过期，正式 Page 是持续保存的源内容。

独立管理的云网关见 [MCP 部署](cloud-mcp-deployment.zh-CN.md)。该模式通过服务器账号授权和同步，与本文的桌面远程连接不同。

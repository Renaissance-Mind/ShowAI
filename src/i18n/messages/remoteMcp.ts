import { defineMessages } from "../index";
export default defineMessages("remoteMcp", {
  "zh-CN": {
    diagnostics: "隧道日志",
    downloadCloudflare: "下载连接工具",
    "auth.title": "连接本机 ShowAI",
    "auth.request": "{client} 请求访问这台电脑上的 ShowAI 项目。",
    "auth.code": "配对码",
    "auth.help":
      "在 ShowAI「设置 → 远程连接」生成配对码。本次授权范围：{permission}；仅包含 App 已选定的项目，新项目不会自动加入。",
    "auth.allow": "确认授权",
    "auth.cancel": "取消",
    "auth.invalid": "配对码无效或已过期。请在 ShowAI 设置中生成新的配对码。",
    "auth.empty": "请先在 ShowAI 设置中选择允许访问的项目。",
    title: "远程连接",
    stopped: "未开启",
    starting: "正在建立连接…",
    running: "服务运行中",
    error: "连接已中断",
    start: "开启连接",
    stop: "关闭连接",
    refresh: "检查工具",
    check: "检查公网连接",
    reachable: "公网连接已验证",
    unreachable: "公网连接未通过",
    unchecked: "等待公网检查",
    cloudflare: "Cloudflare",
    tailscale: "Tailscale",
    quick: "临时地址",
    named: "固定域名",
    provider: "连接方式",
    quickNote:
      "临时地址会在重新连接后变化，仅用于临时接入。",
    tailscaleNote:
      "使用自己的 Tailscale 账号与 ts.net 地址。",
    url: "公网 HTTPS 地址",
    token: "隧道令牌",
    tokenSaved: "已安全保存；留空继续使用",
    tokenEmpty: "粘贴该隧道的 Token",
    port: "本机端口",
    executable: "工具路径",
    detected: "已找到 {tool}",
    selectedTool: "使用指定的 {tool} 程序",
    missing: "尚未找到 {tool}",
    choose: "选择程序",
    auto: "自动检测",
    projects: "允许访问的项目",
    noProjects: "先创建一个项目，再开启远程连接。",
    read: "只读",
    write: "可编辑",
    permission: "{name} 的访问权限",
    address: "MCP 地址",
    copy: "复制",
    copied: "已复制",
    pairing: "连接授权",
    generate: "生成配对码",
    pairingNote:
      "在 MCP 的授权页面输入此码，有效期 10 分钟，只可使用一次。不要把配对码发给聊天模型。",
    clients: "已授权客户端",
    revoke: "撤销",
    noClients: "尚无客户端完成授权。",
    lastCall: "最近工具调用：{time}",
    chatgpt: "接入 ChatGPT",
    other: "接入其他电脑",
    setup: "配置教程",
    advanced: "连接设置",
    desktopOnly: "请在 ShowAI 桌面 App 中开启远程连接。",
    onlineNote:
      "远程访问需要这台电脑保持联网、唤醒且 ShowAI 正在运行。退出 App 会关闭连接。",
    chatgpt1: "开启连接并确认公网检查通过，复制 MCP 地址。",
    chatgpt2:
      "在 ChatGPT 的插件页面选择添加自定义 MCP 服务，粘贴地址并选择 OAuth。该入口受账号与工作区策略限制。",
    chatgpt3:
      "在这里生成配对码。在 ChatGPT 打开的 ShowAI 授权页面输入配对码，核对权限并确认授权。",
    chatgpt4:
      "回到 ChatGPT，选择刚添加的插件，请它列出项目。此处出现最近工具调用时间，才能确认真实调用成功。",
    otherText:
      "在支持远程 MCP（HTTP） 和 OAuth 的客户端中添加相同 MCP 地址，完成配对授权。每个客户端独立授权，可在此撤销。其他电脑无需安装隧道工具。",
    openChatgpt: "打开 ChatGPT 插件",
    installCloudflare: "安装 cloudflared",
    installTailscale: "安装 Tailscale",
    cloudDashboard: "打开 Cloudflare 控制台",
    tailscaleAdmin: "打开 Tailscale 控制台",
    quick1:
      "点击下载连接工具，ShowAI 会下载官方 cloudflared 并校验文件。已有安装时点击检查工具；未找到时可选择程序路径。",
    quick2:
      "选择项目和权限，点击开启连接。ShowAI 自动启动本机 MCP 和临时隧道，并检查公网地址。",
    named1:
      "在自己的 Cloudflare 账号中添加域名，并创建一个 Cloudflare 隧道。仅复制隧道 Token，粘贴到上方；无需手动运行连接器。",
    named2:
      "为隧道添加 发布应用 路由：选择自己的子域名，服务设为 HTTP，地址设为下方本机地址。将该子域名的 HTTPS 地址填入上方。",
    named3:
      "不要在 MCP 路由前添加交互式 Access 登录页。项目访问由 ShowAI 的 OAuth 控制。点击开启连接后检查公网连接。",
    tailscale1:
      "安装并登录自己的 Tailscale 账号，确认设备在线。回到此页检查工具。",
    tailscale2:
      "在 Tailscale 控制台启用 MagicDNS、HTTPS 和 Funnel 权限。参考下方官方教程完成必须由账号所有者批准的步骤。",
    tailscale3:
      "点击开启连接。ShowAI 使用独立前台 Funnel 进程转发本机端口；如果 443 已被其他服务使用，会停止并提示，不覆盖原有配置。",
    docs: "官方教程",
    route: "Cloudflare 路由目标",
    selected: "{count} 个项目",
    status: "连接状态",
    working: "处理中…",
  },
  en: {
    diagnostics: "Tunnel log",
    downloadCloudflare: "Download connector",
    "auth.title": "Connect local ShowAI",
    "auth.request":
      "{client} requests access to this computer's ShowAI projects.",
    "auth.code": "Pairing code",
    "auth.help":
      "Generate a code in ShowAI Settings → Remote connection. Requested access: {permission}. Only projects selected in the App are included; new projects are not added automatically.",
    "auth.allow": "Authorize",
    "auth.cancel": "Cancel",
    "auth.invalid":
      "Invalid or expired pairing code. Generate a new code in ShowAI Settings.",
    "auth.empty": "Select projects in ShowAI Settings first.",
    title: "Remote connection",
    stopped: "Off",
    starting: "Connecting…",
    running: "Service running",
    error: "Connection interrupted",
    start: "Start connection",
    stop: "Stop connection",
    refresh: "Check tools",
    check: "Check public connection",
    reachable: "Public connection verified",
    unreachable: "Public check failed",
    unchecked: "Awaiting public check",
    cloudflare: "Cloudflare",
    tailscale: "Tailscale",
    quick: "Temporary URL",
    named: "Custom domain",
    provider: "Connection method",
    quickNote:
      "The temporary URL changes when reconnecting. Use it for temporary access.",
    tailscaleNote:
      "Use your own Tailscale account and ts.net address.",
    url: "Public HTTPS address",
    token: "Tunnel Token",
    tokenSaved: "Saved securely; leave blank to reuse",
    tokenEmpty: "Paste this tunnel's token",
    port: "Local port",
    executable: "Executable",
    detected: "Found {tool}",
    selectedTool: "Using the selected {tool} executable",
    missing: "{tool} was not found",
    choose: "Choose executable",
    auto: "Detect automatically",
    projects: "Allowed projects",
    noProjects: "Create a project before enabling remote access.",
    read: "Read only",
    write: "Can edit",
    permission: "Access to {name}",
    address: "MCP URL",
    copy: "Copy",
    copied: "Copied",
    pairing: "Authorize a connection",
    generate: "Generate pairing code",
    pairingNote:
      "Enter this code on the MCP authorization page. Valid for 10 minutes and one use. Do not send it to the chat model.",
    clients: "Authorized clients",
    revoke: "Revoke",
    noClients: "No clients have completed authorization.",
    lastCall: "Last tool call: {time}",
    chatgpt: "Connect ChatGPT",
    other: "Connect another computer",
    setup: "Setup guide",
    advanced: "Connection settings",
    desktopOnly: "Enable remote connections in the ShowAI desktop App.",
    onlineNote:
      "This computer must stay online, awake, and running ShowAI. Quitting the App closes the connection.",
    chatgpt1:
      "Start the connection, verify the public check, and copy the MCP URL.",
    chatgpt2:
      "In ChatGPT Plugins, add a custom MCP server, paste the URL and select OAuth. Account and workspace policies apply.",
    chatgpt3:
      "Generate a pairing code here. Enter it on the ShowAI authorization page opened by ChatGPT, review the permissions and authorize.",
    chatgpt4:
      "Return to ChatGPT, select the new plugin and ask it to list projects. A recent tool call here confirms that an actual call succeeded.",
    otherText:
      "Add the same MCP URL in a client supporting remote HTTP MCP and OAuth, then complete pairing. Each client has an independent, revocable grant. The other computer does not need tunnel software.",
    openChatgpt: "Open ChatGPT Plugins",
    installCloudflare: "Install cloudflared",
    installTailscale: "Install Tailscale",
    cloudDashboard: "Open Cloudflare dashboard",
    tailscaleAdmin: "Open Tailscale admin",
    quick1:
      "Download the connector here; ShowAI downloads and verifies the official cloudflared binary. For an existing installation, check tools or choose its executable.",
    quick2:
      "Select projects and permissions, then start the connection. ShowAI starts the local MCP and temporary tunnel and checks the public address.",
    named1:
      "Add a domain to your Cloudflare account and create a Cloudflared Tunnel. Copy only its tunnel token into the field above; do not start the connector manually.",
    named2:
      "Add a Published application route: select your subdomain, choose HTTP and use the local address below. Enter the subdomain's HTTPS address above.",
    named3:
      "Do not put an interactive Access login page in front of the MCP route. ShowAI OAuth controls project access. Start the connection and check public reachability.",
    tailscale1:
      "Install Tailscale, sign into your own account and check that the device is online. Check tools here.",
    tailscale2:
      "Enable MagicDNS, HTTPS and Funnel permission in Tailscale admin. Follow the official guide below for steps requiring the account owner's approval.",
    tailscale3:
      "Start the connection. ShowAI uses a foreground Funnel process to forward the local port. If port 443 already serves another application, it reports the conflict without overwriting that configuration.",
    docs: "Official guide",
    route: "Cloudflare route target",
    selected: "{count} projects",
    status: "Connection status",
    working: "Working…",
  },
});

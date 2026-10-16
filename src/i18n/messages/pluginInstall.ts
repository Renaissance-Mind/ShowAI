import { defineMessages } from "../index";

export default defineMessages("pluginInstall", {
  "zh-CN": {
    title: "安装 ShowAI 插件",
    detail:
      "让 Codex 或 Claude Code 读写 ShowAI 内容。插件与运行时由 App 提供，连接时自动启动 MCP。",
    refresh: "重新检测",
    scanning: "正在检测…",
    missing:
      "未找到宿主。请先安装 Codex 或 Claude Code，并确保其命令行工具可用，再重新检测。",
    scanFailed: "无法读取插件状态，请检查下方错误或更新宿主后重试。",
    otherSource:
      "已启用其他来源的 ShowAI 插件。若要改用 App 版本，请先在宿主中停用原插件，再重新检测。",
    installed: "已安装并启用",
    disabled: "已安装，尚未启用",
    ready: "可安装",
    install: "安装插件",
    update: "更新并启用",
    installing: "正在安装…",
    success: "插件已安装并启用，文件核验通过。",
    refreshHost:
      "请在 Codex 中刷新插件或重启 Codex；Claude Code 请重启会话，加载新的工具和 Skills。",
    details: "安装详情",
    verifiedFiles: "个文件已核验",
    library: "插件连接当前内容库；切换内容库或移动 App 后，可再次更新插件：",
  },
  en: {
    title: "Install the ShowAI plugin",
    detail:
      "Let Codex or Claude Code work with ShowAI content. The App supplies the plugin and runtime; MCP starts automatically when connected.",
    refresh: "Check again",
    scanning: "Checking…",
    missing:
      "Host not found. Install Codex or Claude Code and make its command-line tool available, then check again.",
    scanFailed:
      "Could not read plugin status. Check the error below or update the host and retry.",
    otherSource:
      "ShowAI is enabled from another source. To use the App version, disable the original plugin in the host, then check again.",
    installed: "Installed and enabled",
    disabled: "Installed, disabled",
    ready: "Ready to install",
    install: "Install plugin",
    update: "Update and enable",
    installing: "Installing…",
    success: "Plugin installed and enabled. Installed files verified.",
    refreshHost:
      "Refresh plugins or restart Codex. For Claude Code, restart the session to load the new tools and Skills.",
    details: "Installation details",
    verifiedFiles: "files verified",
    library:
      "The plugin connects to this library. Update it again after switching libraries or moving the App:",
  },
});

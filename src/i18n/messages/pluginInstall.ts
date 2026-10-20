import { defineMessages } from "../index";

export default defineMessages("pluginInstall", {
  "zh-CN": {
    title: "安装 ShowAI 插件",
    detail:
      "让 Codex、Claude Code 或 DeepSeek Harness 读写 ShowAI 内容。插件与运行时由 App 提供，连接时自动启动 MCP。",
    refresh: "重新检测",
    scanning: "正在检测…",
    missing:
      "未找到宿主。请先安装 Codex 或 Claude Code，并确保其命令行工具可用，再重新检测。",
    scanFailed: "无法读取插件状态，请检查下方错误或更新宿主后重试。",
    otherSource:
      "已启用其他来源的 ShowAI 插件。若要改用 App 版本，请先在宿主中停用原插件，再重新检测。",
    installed: "已安装并启用",
    outdated: "已安装并启用，有可用更新",
    reinstall: "重新安装",
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
    dshMissing: "未找到 DeepSeek Harness。请先安装并打开一次，再重新检测。",
    dshStaged: "插件文件已准备，尚未在 DeepSeek Harness 中安装",
    dshPrepare: "准备插件",
    dshUpdate: "更新插件文件",
    dshStagedDone:
      "插件文件已准备并核验。DeepSeek Harness 由自己安装插件，请按以下步骤完成：",
    dshOpenOnce: "先打开一次 DeepSeek Harness，让它创建桌面配置。",
    dshRemoveOther:
      "在 DeepSeek Harness「插件」中移除从其他位置安装的 ShowAI：",
    dshRemoveLegacy: "在 DeepSeek Harness「插件」中移除旧版插件：",
    dshRemoveRow: "删除手动添加的 mcp-showai 配置（id: mcp-showai 整段）：",
    dshRemoveSkills: "删除手动复制、会覆盖插件版本的 Skill 文件夹，位于",
    dshAdd:
      "在 DeepSeek Harness 侧栏「插件 → 添加插件」中粘贴下方路径，安装后点「立即启用」。",
    dshEnable: "在 DeepSeek Harness「插件」中打开 ShowAI。",
    dshRestart:
      "重启 DeepSeek Harness，加载工具、Skills 与对话内预览。以后更新插件文件后同样需要重启。",
    copyPath: "复制路径",
    copied: "已复制",
  },
  en: {
    title: "Install the ShowAI plugin",
    detail:
      "Let Codex, Claude Code or DeepSeek Harness work with ShowAI content. The App supplies the plugin and runtime; MCP starts automatically when connected.",
    refresh: "Check again",
    scanning: "Checking…",
    missing:
      "Host not found. Install Codex or Claude Code and make its command-line tool available, then check again.",
    scanFailed:
      "Could not read plugin status. Check the error below or update the host and retry.",
    otherSource:
      "ShowAI is enabled from another source. To use the App version, disable the original plugin in the host, then check again.",
    installed: "Installed and enabled",
    outdated: "Installed and enabled · update available",
    reinstall: "Reinstall",
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
    dshMissing:
      "DeepSeek Harness not found. Install it and open it once, then check again.",
    dshStaged: "Plugin files prepared, not yet installed in DeepSeek Harness",
    dshPrepare: "Prepare plugin",
    dshUpdate: "Update plugin files",
    dshStagedDone:
      "Plugin files prepared and verified. DeepSeek Harness installs plugins itself; finish with these steps:",
    dshOpenOnce:
      "Open DeepSeek Harness once so it creates its Desktop profile.",
    dshRemoveOther:
      "In DeepSeek Harness Plugins, remove the ShowAI copy installed from:",
    dshRemoveLegacy: "In DeepSeek Harness Plugins, remove the earlier bundle:",
    dshRemoveRow:
      "Delete the hand-written mcp-showai entry (the whole id: mcp-showai block) from:",
    dshRemoveSkills:
      "Delete the copied Skill folders that override the plugin's version, in",
    dshAdd:
      "In the DeepSeek Harness sidebar, open Plugins → Add plugin, paste the path below, then choose Enable now.",
    dshEnable: "In DeepSeek Harness Plugins, switch ShowAI on.",
    dshRestart:
      "Restart DeepSeek Harness to load the tools, Skills and inline previews. Restart again after each plugin file update.",
    copyPath: "Copy path",
    copied: "Copied",
  },
});

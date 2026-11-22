# ShowAI for Claude Code

[English](README.md)

会话提供 HTML 展示工具时可展示交互预览和原页卡片。桌面会话可在可用的 Browser 或预览中编辑原页；终端交付 HTML 文件和原页链接。

在 ShowAI 的「设置 → Agent 插件」安装或更新 Claude Code 插件，重启会话。在插件管理器核对 ShowAI 已启用，在 MCP 状态中检查连接。

打开新会话，调用 `showai_capabilities` 确认 ShowAI 可用，再用 `projects_list` 查看可访问的项目。项目绑定连接用 `project_context` 确认项目。

使用源码市场时，将 ShowAI 仓库添加为 Claude Code 插件市场并安装 `showai@renaissance-mind`。绑定开发实例可运行 `npm run plugin:claude -- --port <端口> --json`。

[连接与排查](skills/use-showai/references/connect-mcp.md) · [展示与编辑](skills/use-showai/references/host-adapter.md)

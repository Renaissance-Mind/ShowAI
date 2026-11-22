# ShowAI for Antigravity

[English](README.md)

聊天内显示交互预览和原页卡片。右侧辅助面板可编辑原页、定位组件并引用选区，全局工作台可浏览项目。

在 ShowAI 的「设置 → Agent 插件」安装或更新 Antigravity 插件，重启会话。从源码安装时先确认 `agy` 可用，再运行 `npm run plugin:antigravity`。

打开新会话，调用 `showai_capabilities` 确认 ShowAI 可用，再用 `projects_list` 查看可访问的项目。项目绑定连接用 `project_context` 确认项目。

绑定开发实例时可运行 `npm run plugin:antigravity -- --port <端口> --json`，用 `--remove` 卸载该插件。

[连接与排查](skills/use-showai/references/connect-mcp.md) · [展示与编辑](skills/use-showai/references/host-adapter.md)

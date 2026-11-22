# ShowAI for Codex

[English](README.md)

在聊天内操作交互预览。点击已保存页面的卡片可在右侧编辑原页、定位组件；支持插件扩展的桌面端还可打开全局工作台并把选区引用到聊天。

在 ShowAI 的「设置 → Agent 插件」安装或更新 Codex 插件，在 Codex 中刷新插件或重启后新开对话。源码安装可在仓库运行 `npm run plugin:install`。

打开新会话，调用 `showai_capabilities` 确认 ShowAI 可用，再用 `projects_list` 查看可访问的项目。项目绑定连接用 `project_context` 确认项目。

源码安装后可运行 `npm run plugin:update -- --json` 更新，回执记录版本、启用状态和安装文件指纹。

[连接与排查](skills/use-showai/references/connect-mcp.md) · [展示与编辑](skills/use-showai/references/host-adapter.md)

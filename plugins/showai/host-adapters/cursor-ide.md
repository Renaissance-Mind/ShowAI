# Cursor IDE 展示适配

<!-- showai-host-delivery:start -->

- 临时可视化用 `show_component` 的 `delivery:"auto"` 在 Cursor 对话中展示。用户可直接操作 MCP App 内的控件。
- 新建或续改保存成功后用 `card_present` 交付一组原页卡片，按本次保存的 `projectId` 和 `pageId` 定位。要在对话里阅读正文时用 `page_present`。只要文件时导出完整 HTML。
- 点击原页卡片或打开 `.showai-ref` 可在 IDE 分栏编辑原页。

<!-- showai-host-delivery:end -->

Cursor 会根据插件名称区分 MCP 服务。已有多个 ShowAI 连接时，使用本次选定的插件，确认内容库后再操作。仅有工具成功回执不能证明用户已看到视图；预览、保存和同步分别核对。

Cursor IDE 的独立工作台扩展自带 Agent 插件，点击卡片本身可在 IDE 分栏打开编辑器。可从命令面板选 **ShowAI: Open Workbench** 浏览项目，或用 `workbench_page_reference` 生成 `.showai-ref`，在 IDE 打开对应页面或组件。

页面预览出现 `inlineError` 或超过对话预算时，按[页面展示](authoring.md)选择关键块重新展示，并提供可用的整页入口。

连接不可用时按[连接向导](connect-mcp.md)恢复。

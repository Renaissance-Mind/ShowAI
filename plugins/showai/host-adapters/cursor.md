# Cursor 展示适配

<!-- showai-host-delivery:start -->

- 临时可视化用 `show_component` 的 `delivery:"auto"` 在 Cursor 对话中展示。用户可直接操作 MCP App 内的控件。
- 新作品保存后用 `page_present` 在对话中展示。续改时说明所在项目、修改和可用的原页入口。用户指定文件交付时导出完整 HTML。
- Cursor 的 Browser 面板可以打开本机 HTML。显示失败时保留原页，按宿主实际返回的错误和可用文件交付。

<!-- showai-host-delivery:end -->

Cursor 会根据插件名称区分 MCP 服务。已有多个 ShowAI 连接时，使用本次选定的插件，确认内容库后再操作。仅有工具成功回执不能证明用户已看到视图；预览、保存和同步分别核对。

需要原页入口时，可从本机 `page_present` 回执取得 `openUrl`。入口不可用时说明项目和页面身份。

页面预览出现 `inlineError` 或超过对话预算时，按[页面展示](authoring.md)选择关键块重新展示，并提供可用的整页入口。

连接不可用时按[连接向导](connect-mcp.md)恢复。

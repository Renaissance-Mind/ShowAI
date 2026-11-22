# WorkBuddy 展示适配

<!-- showai-host-delivery:start -->

- 临时可视化用 `show_component` 的 `delivery:"auto"` 在 WorkBuddy 对话中展示。用户可直接操作 MCP App 内的控件。
- 新作品保存后用 `page_present` 展示。续改时说明所在项目、修改和可用的原页入口。用户指定文件交付时导出完整 HTML。
- 按宿主实际提供的产物入口交付文件或交互界面。显示失败时保留已保存的原页。

<!-- showai-host-delivery:end -->

WorkBuddy 本机插件使用宿主自己的插件清单和 `.mcp.json`。新会话确认插件工具可用；访问项目时核对目标内容库。安装或管理页显示已启用后，也要在当前会话实际调用一次工具。

需要原页入口时，可从本机 `page_present` 回执取得 `openUrl`。入口不可用时说明项目和页面身份。

页面预览出现 `inlineError` 或超过对话预算时，按[页面展示](authoring.md)选择关键块重新展示，并提供可用的整页入口。

连接不可用时按[连接向导](connect-mcp.md)检查。工具成功回执、用户看到交互视图、Page 保存和同步分别核对。

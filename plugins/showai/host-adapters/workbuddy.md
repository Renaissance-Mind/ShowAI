# WorkBuddy 展示适配

<!-- showai-host-delivery:start -->

- 临时可视化用 `show_component` 的 `delivery:"auto"` 在 WorkBuddy 对话中展示。用户可直接操作 MCP App 内的控件。
- 新建或续改保存成功后，用 `card_present` 交付一组原页卡片。明确要求在对话中阅读正文时用 `page_present`。用户指定文件交付时导出完整 HTML。
- 用户要在任务旁编辑时，用 `workbench_page_url` 取得原页编辑地址，再用会话提供的 WorkBuddy 浏览器打开。卡片可打开浏览器并提供复制编辑链接的操作。

<!-- showai-host-delivery:end -->

WorkBuddy 本机插件使用宿主自己的插件清单和 `.mcp.json`。新会话确认插件工具可用；访问项目时核对目标内容库。安装或管理页显示已启用后，也要在当前会话实际调用一次工具。

浏览器内的 ShowAI 编辑器保存到同一个项目和页面。没有可用的内置浏览器工具时，交付可编辑的链接供用户打开。插件启用后在新会话核对实际可见的 `card_present` 和 `workbench_page_url`。

页面预览出现 `inlineError` 或超过对话预算时，按[页面展示](authoring.md)选择关键块重新展示，并提供可用的整页入口。

连接不可用时按[连接向导](connect-mcp.md)检查。工具成功回执、用户看到交互视图、Page 保存和同步分别核对。

# MCP Apps 展示适配

<!-- showai-host-delivery:start -->

- 通用插件使用随包或宿主已配置的 ShowAI MCP。支持 MCP Apps 的客户端用 `show_component` 的 `delivery:"auto"` 呈现附带的 `mcp-app` 视图。文本客户端给出结果和可访问的页面或文件链接。
- 连接提供 `card_present` 时，新建或续改保存成功后用一组原页卡片交付。使用本轮最终保存的页面身份。用户要求在聊天里阅读原页或片段时用 `page_present`。没有卡片工具时按实际可用的阅读视图、原页链接或 HTML 交付。
- 视图出现后只补充必要解释。出现 `inlineError` 或视图加载失败时查完整宿主适配。

<!-- showai-host-delivery:end -->

配置和验证见[连接向导](connect-mcp.md)。最终回复只补充必要解释。远程 delivery 中的 URL 是可访问的交付地址，按返回的链接交付。

<!-- showai-only:chatgpt -->

ChatGPT Work 连接有授权的桌面运行时并提供 `card_open` 时，用它打开指定原页的编辑器。用户也能从对话的 ShowAI 面板编辑页面，或从全局 ShowAI 入口浏览已授权项目。

<!-- /showai-only -->

<!-- showai-only:local -->

通用本机连接提供 `workbench_page_url` 时，可将原页编辑链接交给宿主的 Browser。

<!-- /showai-only -->

页面超出对话预算时（嵌入图片是常见原因）结果带 `inlineError`，附带视图只显示原因和完整文件链接：用 page_read 的 `detail:"outline"` 取得块 ID，带一到三个关键块的 blockIds 再调用一次，并说明整页的打开方式。

工具附带视图资源不证明用户已看到。没有视图时，核对当前宿主实际能力与加载错误，保留已保存的 Page 和可用交付地址；不能用另建页面或更换内容库绕过。保存、同步、视图实际显示分别确认。

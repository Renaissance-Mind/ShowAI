# MCP Apps 展示适配

<!-- showai-host-delivery:start -->

- 此连接声明 `mcp-app`。临时组件用 `show_component` 的 `delivery:"auto"`，由宿主呈现附带的 MCP Apps 组件视图。
- 新作品保存后用 `page_present` 展示。续改说明改动、所在项目和可用的原页链接。用户要求在聊天里阅读原页或片段时用 `page_present`。
- 视图出现后只补充必要解释。出现 `inlineError` 或视图加载失败时查完整宿主适配。

<!-- showai-host-delivery:end -->

最终回复只补充必要解释，不输出本机文件引用或其他宿主的展示指令。远程 delivery 中的 URL 是可访问的交付地址，不是本机路径；不要读取服务端文件系统，也不要为了展示配置本机启动器。

页面超出对话预算时（嵌入图片是常见原因）结果带 `inlineError`，附带视图只显示原因和完整文件链接：用 page_read 的 `detail:"outline"` 取得块 ID，带一到三个关键块的 blockIds 再调用一次，并说明整页的打开方式。

工具附带视图资源不证明用户已看到。没有视图时，核对当前宿主实际能力与加载错误，保留已保存的 Page 和可用交付地址；不能用另建页面或更换内容库绕过。保存、同步、视图实际显示分别确认。

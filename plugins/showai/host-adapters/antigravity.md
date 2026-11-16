# Antigravity 展示适配

此插件声明 `SHOWAI_HOST_DISPLAY=fragment-file`。show_component 使用 `delivery:"auto"`，返回本机 `delivery.inline` 离线片段路径；page_present 与 render_document 同样返回本机 `delivery.inline` 与完整离线文件 `delivery.html`。

Antigravity 对话内嵌视图（`<agent-embed>`）禁止加载外部公共 CDN，只能呈现 `display.reader` 为 `bundled` 的自包含离线 HTML，且内嵌文件必须位于当前会话的 Artifact 目录（`<Artifact Directory>`，即 `<appDataDir>/brain/<conversation-id>`）。取得 `delivery.inline` 后，先核对结果中的 `display.reader`：

- `bundled`：由于 `delivery.inline` 内含打包后的本地阅读器（通常数百 KB），不要用 `read_file` / `write_file` 逐字转写，而是用 `cp` 将 `delivery.inline` 原样复制到当前会话的 Artifact 目录（例如 `<Artifact Directory>/showai-preview.html`），再在回复中单独一行输出 `<agent-embed src="file:///实际复制后的Artifact绝对路径"></agent-embed>` 在对话内直接展示。page_present 同时给出项目名称与 `openUrl`；render_document 同时给出 `delivery.html` 完整离线文件路径。
- `cdn` 或结果只带 `inlineError`：表示内联预览超出离线阅读器预算（`display.readerReason` 会给出大小与上限，嵌入大图是常见原因），`<agent-embed>` 无法联网加载阅读器。正式页面用 page_read 的 `detail:"outline"` 取得块 ID，选一到三个不含大图的关键块带 `blockIds` 再调用一次 page_present，按上一条将返回的 `bundled` 离线片段复制到 Artifact 目录并用 `<agent-embed>` 内嵌展示，同时给出整页的 `openUrl` 与 `delivery.html` 完整离线文件路径；单个块仍超限时不再内嵌，直接给出 `openUrl` 与 `delivery.html`。

不要手写或改写 ShowAI 生成的 HTML，不把未经复制到 Artifact 目录的临时路径直接写进 `<agent-embed>`，也不输出其他宿主的展示指令。工具调用、文件复制与实际显示分别核对；正文只补充必要结论。

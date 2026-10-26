# Codex 展示适配

此插件绑定 Codex 本机文件式展示，声明 `SHOWAI_HOST_DISPLAY=codex-visualize`。先核对当前连接回显；show_component 默认使用 `delivery:"auto"`，返回 fragment-file 后，使用实际 delivery.inline 路径。

最终回复在代码块外单独一行写下面的完整引用，仅替换 path，保留全部专用定界符：

```text
visualize{"path":"实际返回的绝对inline文件路径"}
```

page_present 和 render_document 的本机 delivery.inline 同样按此契约交付。普通文字 visualize 加 JSON 不是有效引用。URL 不是本机文件路径；远程连接另有 MCP Apps 视图时，以该连接的实际能力为准。

已经确认当前入口能显示 MCP Apps 时，可以显式选择 `delivery:"mcp-app"`；返回该模式后，最终回复只补充解释，不追加文件引用。用户看到原样引用时检查定界符；Markdown 符号原样显示还需检查宿主正文渲染。文件存在和工具附带资源都不能单独证明用户已看到。

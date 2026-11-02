# Codex 展示适配

此插件绑定 Codex 本机文件式展示，声明 `SHOWAI_HOST_DISPLAY=codex-visualize`。先核对当前连接回显；show_component 默认使用 `delivery:"auto"`，返回 fragment-file 后，使用实际 delivery.inline 路径。

最终回复在代码块外单独一行写下面的完整引用，仅替换 path，保留全部专用定界符：

```text
visualize{"path":"实际返回的绝对inline文件路径"}
```

page_present 和 render_document 的本机 delivery.inline 同样按此契约交付。页面超出对话预算时（嵌入图片是常见原因）结果没有 delivery.inline，只带 `inlineError`：用 page_read 的 `detail:"outline"` 取得块 ID，带一到三个不含大图的关键块的 blockIds 再调用一次，按上面的引用交付新的 delivery.inline，并说明整页可用 openUrl 打开；单个块也超限时给出 openUrl 和 delivery.html 的路径，不把 delivery.html 写进 visualize 引用。普通文字 visualize 加 JSON 不是有效引用。URL 不是本机文件路径；远程连接另有 MCP Apps 视图时，以该连接的实际能力为准。

已经确认当前入口能显示 MCP Apps 时，可以显式选择 `delivery:"mcp-app"`；返回该模式后，最终回复只补充解释，不追加文件引用。用户看到原样引用时检查定界符；Markdown 符号原样显示还需检查宿主正文渲染。文件存在和工具附带资源都不能单独证明用户已看到。

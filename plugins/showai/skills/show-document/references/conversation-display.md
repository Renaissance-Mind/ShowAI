# 对话展示与完整交付

页面保存与展示分开。正式页面先核实保存，再调用 MCP `page_present`；明确的独立交付使用 `render_document`。输出目录由宿主或运行时配置，Agent使用真实delivery，不自行决定新的内容库或导出路径。

## 宿主适配

| 实际能力 | 使用结果 |
| --- | --- |
| MCP Apps | 工具附带reader资源，宿主把结果交给阅读器；不必先下载HTML |
| Codex本机可视化 | delivery.inline是本机可访问路径时，在最终回复使用下面的引用 |
| 宿主要求模型在回复中直接写出 HTML（如 Claude 的 HTML/可视化工具） | 读取 delivery.inline 文件的完整文本，原样交给该工具；不改写、不截断 |
| 文件/网页预览 | 联网阅读优先打开delivery.online；需要离线或宿主不能联网时打开delivery.html。两者都是阅读快照，不自动回写项目 |
| 无内嵌显示 | 交付项目、Page、版本、保存/同步结果；需要时附文件链接 |

运行时带有已发布的 CDN 阅读器时，delivery.inline 与 delivery.online 只携带页面数据、内嵌图片和自定义组件，阅读器与内置组件从 jsDelivr（失败时 unpkg）按需加载，体积通常只有几 KB 到几百 KB，打开时需要联网。delivery.html 始终是离线完整文件。display.onlineAvailable 为 false 时没有在线版，按原方式使用 delivery.html；宿主显示“无法加载 ShowAI 阅读器”时同样改用 delivery.html。

Codex当前引用契约：

```text
visualize{"path":"实际返回的绝对inline文件路径"}
```

HTML URL不能填写为本机path。远程HTTP交付是URL时，优先使用已经呈现的MCP Apps；宿主允许下载且要求文件式可视化时才取得内容，并遵循其当前引用约定。不要把Codex引用发给其他宿主。调用成功或打开面板不证明已经显示。

## 路径与持久性

本机page_present默认在连接内容库的local/agent-previews生成交付物；宿主可通过SHOWAI_PRESENTATION_DIR或启动配置指定可读的任务输出目录。Codex会话可视化目录是可用的宿主选择，不是ShowAI源页面的存储要求。保存位置仍由连接与项目决定。

HTTP结果含有时限的下载地址。完整源文件或项目是长期保存依据。独立render_document返回savedToProject=false；page_present展示已保存Page，返回其身份、hash/revision。synchronized只表示此次操作是否确认了同步，本机返回not_checked时不能据此称远端已更新。

## 局部预览

用户未指定展示范围时，先尝试完整page_present；用户明确要求局部时，直接按真实节点选择。完整预览超限时，从完整page_read取得blockIds，选择可独立理解的区域再调用page_present。它的完整HTML/source保留全页，inline只含选区。初始窗口高度有限与只导出了部分节点是两回事；放大局部预览不会自动补齐其他节点，应打开完整HTML。

page_export用于明确的文件导出；它的blockIds会使该导出及同名source本身成为局部投影。不能用局部source替换完整Page。操作自定义组件内部的章节前，确认它是否真的是独立页面节点。

交付时核对保存回执、同步回执、完整阅读文件与实际显示。默认给本轮预览；用户指定只保存、文件、面板或后台执行时采用其指定。无显示能力不影响已经授权的项目读写。

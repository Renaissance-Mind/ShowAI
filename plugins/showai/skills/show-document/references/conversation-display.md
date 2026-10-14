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

对话预览优先把本地阅读器及所需组件压缩到 delivery.inline，打开时无需下载阅读器。压缩后仍超出聊天预算且运行时有已发布 CDN 阅读器时，才使用较小的在线片段。显式 page_export 的 reader:"cdn" 也会使用在线阅读器，reader:"bundled" 强制离线打包。运行时随软件安装本地阅读器并缓存按页面依赖编译的结果；安装插件只更新连接与技能，不更新软件运行时，也不能预热对话宿主的浏览器缓存。

delivery.online 是另行提供的在线完整页，阅读器与内置组件从 jsDelivr／unpkg 按需加载；delivery.html 始终是离线完整文件。display.onlineAvailable 只表示是否有在线版，不能据此判断 inline 是否联网。CDN 加载在首个来源等待 1.5 秒后启动备用来源，先完成者挂载，15 秒仍未完成则显示错误。加载错误可能来自网络、宿主策略或阅读器异常；没有控制台证据时不直接断言 CDN 被拦截。必要时交付 delivery.html 文件或链接，不把完整 HTML 粘进对话，也不通过插件重装声称已经修复运行时。

Codex当前引用契约：

```text
visualize{"path":"实际返回的绝对inline文件路径"}
```

MCP Apps阅读器会把读者在预览里调整的控件（滑块、选项、标签页等）的最新取值作为模型上下文提供，结构为`showai.readerState`，含blockId、控件标签和取值。它只表示用户当前在预览中的探索，未写入页面；用于理解“按这个继续”这类追问。用户要求保留该状态时，再按正常流程读取并保存页面。

HTML URL不能填写为本机path。远程HTTP交付是URL时，优先使用已经呈现的MCP Apps；宿主允许下载且要求文件式可视化时才取得内容，并遵循其当前引用约定。不要把Codex引用发给其他宿主。调用成功或打开面板不证明已经显示。

## 路径与持久性

本机page_present默认在连接内容库的local/agent-previews生成交付物；宿主可通过SHOWAI_PRESENTATION_DIR或启动配置指定可读的任务输出目录。Codex会话可视化目录是可用的宿主选择，不是ShowAI源页面的存储要求。保存位置仍由连接与项目决定。

HTTP结果含有时限的下载地址；要交给其他电脑长期使用时，下载 delivery.online 或 delivery.html 后作为文件交付。完整源文件或项目是长期保存依据。独立render_document返回savedToProject=false；page_present展示已保存Page，返回其身份、hash/revision。synchronized只表示此次操作是否确认了同步，本机返回not_checked时不能据此称远端已更新。

## 局部预览

用户未指定展示范围时，先尝试完整page_present；用户明确要求局部时，直接按真实节点选择。完整预览超限时，从完整page_read取得blockIds，选择可独立理解的区域再调用page_present。它的完整HTML/source保留全页，inline只含选区。初始窗口高度有限与只导出了部分节点是两回事；放大局部预览不会自动补齐其他节点，应打开完整HTML。

page_export用于明确的文件导出；它的blockIds会使该导出及同名source本身成为局部投影。不能用局部source替换完整Page。操作自定义组件内部的章节前，确认它是否真的是独立页面节点。

交付时核对保存回执、同步回执、完整阅读文件与实际显示。默认给本轮预览；用户指定只保存、文件、面板或后台执行时采用其指定。无显示能力不影响已经授权的项目读写。

# 宿主显示与完整交付

对话展示与文档共用这里的宿主规则。对话中看一眼的组件用 `show_component`，不保存；正式页面先核实保存，再调用 MCP `page_present`；完整独立文件使用 `render_document`。输出目录由宿主或运行时配置，Agent使用真实delivery，不自行决定新的内容库或导出路径。

## 宿主声明

宿主名称不能证明显示能力。各宿主的插件在 MCP 启动配置里声明 `SHOWAI_HOST_DISPLAY`，`showai_capabilities.presentation.declaredHostDisplay` 回显实际值；`show_component` 的 `delivery:"auto"` 按它选择：

| 声明              | 宿主                                                             | show_component 交付                                                                           |
| ----------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `mcp-app`         | 支持 MCP Apps 的对话客户端（含托管 HTTP 连接）                   | 附带 `ui://showai/component-v1.html` 组件视图，不写文件                                       |
| `codex-visualize` | Codex                                                            | `fragment-file`：片段写入宿主的展示目录，最终回复使用下面的 Codex 引用                        |
| `fragment-file`   | 读取本机片段文件的其他宿主（DeepSeek Harness 预览、Kimi Widget） | 同上，宿主按自己的方式显示 delivery.inline 指向的文件                                         |
| `model-html`      | 由模型在回复中写出 HTML 的宿主（如 Claude Code 的 show_widget）  | `compact`：返回几 KB 片段文本，原样交给该工具；超过 32 KB 或没有 CDN 阅读器时改为图片         |
| `image`           | 没有交互显示的客户端                                             | PNG 图片附件                                                                                  |
| `native`          | ShowAI 内置 Agent                                                | 同 mcp-app，由 App 直接渲染                                                                   |
| 未声明            | 未知                                                             | 附带组件视图并返回 warning；宿主实际没有显示时，显式选择 image、compact 或 fragment-file 重试 |

组件视图与页面阅读器使用同一套 MCP Apps 消息、主题与 `showai.readerState` 回传，但不显示页面标题和“⋯”菜单，背景透明。fragment-file 只在本连接的展示目录下的 show-components 中保留最近 20 份，是对话预览而非交付文件。

## 宿主适配

所有宿主遵循同一规则：能放下本地阅读器就离线交付，放不下才在线加载阅读器。同一宿主有多种方式时，优先能交付文件的方式（MCP Apps、inline 路径引用、发布 delivery.html），最后才是由模型写出 HTML。

| 实际能力                                                    | 使用结果                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP Apps                                                    | 工具附带reader资源，宿主把结果交给阅读器；不必先下载HTML                                                                                                                                                                              |
| Codex本机可视化                                             | delivery.inline是本机可访问路径时，在最终回复使用下面的引用                                                                                                                                                                           |
| 宿主要求模型在回复中直接写出 HTML（如 Claude 的可视化工具） | 读取 delivery.compact 的完整文本原样交给该工具：inline 通常有几百 KB，不适合逐字写进回复，compact 只带页面数据，通常几 KB，打开时在线加载阅读器。没有 compact，或 compact 因内嵌大图等仍有几十 KB 以上时，改为交付 delivery.html 文件 |
| 宿主能打开或发布本地文件（文件预览、Claude Artifact 等）    | 使用 delivery.html：离线完整页，打开不需要联网                                                                                                                                                                                        |
| 无内嵌显示                                                  | 交付项目、Page、版本、保存/同步结果；需要时附文件链接                                                                                                                                                                                 |

delivery.inline 优先携带压缩后的本地阅读器与本页组件，多数页面几百 KB，打开不联网；只有压缩后仍超出聊天预算时才改为在线片段。delivery.html 始终是离线完整文件。delivery.compact 与 delivery.online 只带页面数据、内嵌图片和自定义组件：compact 是放进对话的片段，online 是可单独打开的完整网页文件。两者的阅读器依次从 ShowAI 阅读器源（reader.showai.renaissancemind.ai）、jsDelivr、unpkg 加载：每个来源等待 1.5 秒后启动下一个，先完成者挂载，15 秒仍未完成显示错误。online 只用于需要分享、在联网环境打开的小体积完整文件。display 中的 inlineAvailable、compactAvailable、onlineAvailable 只表示文件是否存在，不代表是否联网。

显式 page_export 的 reader:"cdn" 写在线页，reader:"bundled" 强制离线。加载错误可能来自网络、宿主策略或阅读器异常；没有控制台证据时不直接断言来源被拦截，改为交付 delivery.html。安装插件只更新连接与技能，不更新软件运行时，也不能预热对话宿主的浏览器缓存。

Codex当前引用契约（page_present 与 show_component 都使用 delivery.inline）：

```text
visualize{"path":"实际返回的绝对inline文件路径"}
```

MCP Apps阅读器会把读者在预览里调整的控件（滑块、选项、标签页等）的最新取值作为模型上下文提供，结构为`showai.readerState`，含blockId、控件标签和取值。它只表示用户当前在预览中的探索，未写入页面；用于理解“按这个继续”这类追问。用户要求保留该状态时，再按正常流程读取并保存页面。

宿主接受模型上下文时，读者还可以在预览里右键「引用到对话」（选区、某一块或整页），组件也可以通过「交给对话」交出当前状态；它们在同一份上下文中分别是`showai.reference`与`showai.components`，读法见 [use-showai 的处理用户引用](../SKILL.md#处理用户引用)。每次更新替换上一份；读者在宿主输入区可见、可删，发送消息前不会进入对话，也不会写入页面。

HTML URL不能填写为本机path。远程HTTP交付是URL时，优先使用已经呈现的MCP Apps；宿主允许下载且要求文件式可视化时才取得内容，并遵循其当前引用约定。不要把Codex引用发给其他宿主。调用成功或打开面板不证明已经显示。

## 路径与持久性

本机page_present默认在连接内容库的local/agent-previews生成交付物；宿主可通过SHOWAI_PRESENTATION_DIR或启动配置指定可读的任务输出目录。Codex会话可视化目录是可用的宿主选择，不是ShowAI源页面的存储要求。保存位置仍由连接与项目决定。

HTTP结果含有时限的下载地址；要交给其他电脑长期使用时，下载 delivery.html（离线）或 delivery.online（小体积、需联网）后作为文件交付。完整源文件或项目是长期保存依据。独立render_document返回savedToProject=false；page_present展示已保存Page，返回其身份、hash/revision。synchronized只表示此次操作是否确认了同步，本机返回not_checked时不能据此称远端已更新。

## 局部预览

用户未指定展示范围时，先尝试完整page_present；用户明确要求局部时，直接按真实节点选择。完整预览超限时，从完整page_read取得blockIds，选择可独立理解的区域再调用page_present。它的完整HTML/source保留全页，inline只含选区。初始窗口高度有限与只导出了部分节点是两回事；放大局部预览不会自动补齐其他节点，应打开完整HTML。

page_export用于明确的文件导出；它的blockIds会使该导出及同名source本身成为局部投影。不能用局部source替换完整Page。操作自定义组件内部的章节前，确认它是否真的是独立页面节点。

交付时核对保存回执、同步回执、完整阅读文件与实际显示。默认给本轮预览；用户指定只保存、文件、面板或后台执行时采用其指定。无显示能力不影响已经授权的项目读写。

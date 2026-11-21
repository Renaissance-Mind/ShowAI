# Claude Code 展示适配

<!-- showai-host-delivery:start -->

- 原创 HTML 的展示工具标记为预加载。若用户的 Claude Code 设置启用了强制延迟加载，可用 ToolSearch 一次选择所需工具。按当前 HTML 展示工具的调用要求，将 `show_component` 以 `delivery:"auto"` 返回的 `delivery.compact` 原样交给它。
- 新作品保存后用 `page_present`，按 `conversation.next` 展示 `conversation.fragment`，给出 `openUrl`。续改说明所改内容、项目与原页链接。
- 收到 `image`、`too-large`、`unavailable` 或阅读器加载失败时查完整宿主适配。

<!-- showai-host-delivery:end -->

此插件声明 `SHOWAI_HOST_DISPLAY=model-html`：用户只能看到模型交给宿主 HTML 展示工具的内容。用户要图、示意图、流程图或其他可视化时，用 show_component 生成，再把返回的片段交给宿主的 HTML 展示工具显示。默认传原创 HTML；明确要求使用已有组件时按 show-visual 的已有组件指南处理。首次展示前核对当前会话实际暴露的 HTML 展示工具（例如 show_widget）及其契约，例如它要求先调用的 read_me；不因宿主名称就假设某个工具已经存在。

show_component 使用 `delivery:"auto"`。返回 compact 时，将 `delivery.compact` 的完整片段原样交给 HTML 展示工具，不要把 HTML 当正文发送。原创 HTML 片段自包含；已有组件的 compact 片段从公共 CDN 加载阅读器。返回 image 时，图片只在工具结果里，用户不一定能看到：按 warnings 告诉用户这次无法在对话里交互展示及原因（例如运行时没有 CDN 阅读器），用户需要保留时转 show-document 保存后给出 openUrl。

page_present 与 render_document 在此宿主返回 `conversation`，按其 `mode` 与 `next` 执行：

- `compact`：把 `conversation.fragment` 原样交给 HTML 展示工具，再给出 openUrl。
- `too-large`：整页片段超出上限。带 `bytes` 时是片段本身超过 32 KB；不带 `bytes` 时是页面数据（通常是嵌入图片）超过聊天预览预算，同时会有 `inlineError`。两种情况都用 page_read 的 `detail:"outline"` 取得块 ID，选读者最需要看的一到三个块（避开大图），带 blockIds 再调用一次，展示返回的片段，并给出整页的 openUrl。所选的块仍超限时减少块数；单个块也超限时只给出 openUrl 或完整 HTML 文件。
- `unavailable`：运行时没有 CDN 阅读器。告诉用户这次无法在对话里展示，给出 openUrl 或完整 HTML 文件。

会话有草稿目录（scratchpad）时，它就是任务工作目录，操作列表、自查截图等中间文件放在那里。

交付完整 HTML 文件时，宿主有发送或展示文件的工具（例如 SendUserFile）就用它把 delivery.html 交给用户；没有这类工具时给出文件路径。

show_widget 返回成功只说明片段已交给宿主；阅读器在用户端从公共 CDN 加载，Agent 无法确认它加载成功。用户反馈没有显示或显示「could not load」时，说明阅读器没有加载：保留源 Page，交付 page_present 返回的 delivery.html 完整离线文件并给出 openUrl；问题持续时指向「设置 → 关于与反馈」。只回复 openUrl 或文件路径不算展示，上文说明的超限或不可用情况除外。page_read 的截图用于自查，不能代替展示交给用户。delivery.inline 通常更大，不逐字重写。需要交互而图片不足时，说明缺少的宿主能力。

不输出其他宿主的文件引用指令。工具调用、文件生成和实际显示分别核对；正文只补充图中关键结论。

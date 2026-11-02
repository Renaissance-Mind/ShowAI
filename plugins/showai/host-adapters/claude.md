# Claude Code 展示适配

此插件声明 `SHOWAI_HOST_DISPLAY=model-html`：用户只能看到模型交给宿主 HTML 展示工具的内容。用户要图、示意图、流程图或其他可视化时，先用 ShowAI 组件（show_component）生成内容；宿主的 HTML 展示工具只用来显示 ShowAI 返回的片段，不手写 SVG 或 HTML 代替组件。目录里确实没有合适的组件时，按 show-visual 的说明临时编写组件。首次展示前核对当前会话实际暴露的 HTML 展示工具（例如 show_widget）及其契约，例如它要求先调用的 read_me；不因宿主名称就假设某个工具已经存在。

show_component 使用 `delivery:"auto"`。返回 compact 时，将 `delivery.compact` 的完整片段原样交给 HTML 展示工具，不要把 HTML 当正文发送。片段从公共 CDN 加载阅读器。返回 image 时，图片只在工具结果里，用户不一定能看到：按 warnings 告诉用户这次无法在对话里交互展示及原因（例如运行时没有 CDN 阅读器），用户需要保留时转 show-document 保存后给出 openUrl。

page_present 与 render_document 在此宿主返回 `conversation`，按其 `mode` 与 `next` 执行：

- `compact`：把 `conversation.fragment` 原样交给 HTML 展示工具，再给出 openUrl。
- `too-large`：整页片段超出上限。带 `bytes` 时是片段本身超过 32 KB；不带 `bytes` 时是页面数据（通常是嵌入图片）超过聊天预览预算，同时会有 `inlineError`。两种情况都用 page_read 的 `detail:"outline"` 取得块 ID，选读者最需要看的一到三个块（避开大图），带 blockIds 再调用一次，展示返回的片段，并给出整页的 openUrl。所选的块仍超限时减少块数；单个块也超限时只给出 openUrl 或完整 HTML 文件。
- `unavailable`：运行时没有 CDN 阅读器。告诉用户这次无法在对话里展示，给出 openUrl 或完整 HTML 文件。

会话有草稿目录（scratchpad）时，它就是任务工作目录，操作列表、自查截图等中间文件放在那里。

交付完整 HTML 文件时，宿主有发送或展示文件的工具（例如 SendUserFile）就用它把 delivery.html 交给用户；没有这类工具时给出文件路径。

show_widget 返回成功只说明片段已交给宿主；阅读器在用户端从公共 CDN 加载，Agent 无法确认它加载成功。用户反馈没有显示或显示「could not load」时，说明阅读器没有加载：保留源 Page，交付 page_present 返回的 delivery.html 完整离线文件并给出 openUrl；问题持续时指向「设置 → 关于与反馈」。只回复 openUrl 或文件路径不算展示，上文说明的超限或不可用情况除外。page_read 的截图用于自查，不能代替展示交给用户。delivery.inline 通常更大，不逐字重写。需要交互而图片不足时，说明缺少的宿主能力。

不输出其他宿主的文件引用指令。工具调用、文件生成和实际显示分别核对；正文只补充图中关键结论。

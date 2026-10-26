# Claude Code 展示适配

此插件声明 `SHOWAI_HOST_DISPLAY=model-html`。首次核对当前宿主实际可用的 HTML 展示工具与契约；不因宿主名称就假设某个工具已经存在。

show_component 使用 `delivery:"auto"`。返回 compact 时，将 delivery.compact 的完整片段原样交给当前宿主的 HTML 展示工具（例如实际暴露的 show_widget），不要把 HTML 当正文发送。片段依赖联网阅读器。返回 image 时，沿用工具附带的图片。

page_present 或 render_document 返回 delivery.compact 文件时，读取文件原文再交给展示工具。delivery.inline 通常更大，不逐字重写。没有 HTML 展示能力、片段过大或阅读器加载失败时，保留源内容并交付可用的完整 HTML 文件；需要交互而图片不足时，说明缺少的宿主能力。

不输出其他宿主的文件引用指令。工具调用、文件生成和实际显示分别核对；正文只补充图中关键结论。

# DeepSeek Harness 展示适配

此插件声明 `SHOWAI_HOST_DISPLAY=fragment-file`。show_component 使用 `delivery:"auto"`。插件会自动读取 show_component、page_present 和 render_document 返回的本机 delivery.inline（缺省时读取 delivery.html），缓存文件并在工具结果旁显示预览。

Agent 不需要输出展示指令，也不需要重写或复制 HTML。页面超出对话预算时（嵌入图片是常见原因）结果没有 delivery.inline，只带 `inlineError`，预览改读体积更大的 delivery.html；需要在对话里看清重点时，用 page_read 的 `detail:"outline"` 取得块 ID，带一到三个关键块的 blockIds 再调用一次。最终回复只补充必要解释；有正式 Page 时给出实际项目与 openUrl。检查工具结果旁的预览是否出现，不以文件已生成代替显示验证。

没有预览时检查 ShowAI 插件的预览部分与 MCP 部分是否都已启用，核对工具是否返回真实本机文件以及宿主错误。保留源 Page 和可用 HTML 文件，不套用其他宿主的引用语法。远程 URL 不能交给本机文件适配器；按远程连接实际支持的视图交付。

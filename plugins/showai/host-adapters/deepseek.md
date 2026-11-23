# DeepSeek Harness 展示适配

<!-- showai-host-delivery:start -->

- Harness 连接后会注册 ShowAI 的 MCP 工具，可直接调用。用 `show_component` 的 `delivery:"auto"` 取得 `fragment-file`，插件自动读取本机 `delivery.inline`（缺省时读取 `delivery.html`），在工具结果旁显示预览。
- 新建或续改保存成功后用 `card_present` 交付原页卡片。多页使用 `additionalTargets`。会话提供侧栏时，点击卡片在右侧打开原页，箭头可改选桌面 App。仅桌面 App 可用时，卡片显示单个「从 ShowAI 打开」按钮。要在对话中阅读正文时用 `page_present`，连接尚未提供卡片工具时可沿用原页预览。
- 确认预览出现后，正文只补充必要结论。缺少预览或返回远程 URL 时查完整宿主适配。

<!-- showai-host-delivery:end -->

## 在 Harness 里继续编辑

| 用户想做什么 | 入口与结果 |
| --- | --- |
| 在聊天中看图或读页面 | 工具结果显示交互预览，折叠执行过程后仍可在回合末尾查看。临时组件无需项目。 |
| 一边聊天一边改已保存的页面 | 点击原页卡片或原页预览的标题区域，或打开会话右侧栏，在新标签中选 ShowAI。右侧显示绑定内容库里的原页。在页面菜单或选区菜单点「引用到 DeepSeek 对话草稿」，带版本的引用会追加到本会话的输入框，由用户检查并发送。 |
| 浏览整个内容库 | 点 Harness 左侧导航的 ShowAI，在主区域管理项目和编辑页面。点原来的会话即可返回聊天。 |

这些界面适用于本机运行的 Harness 图形客户端和配套的 ShowAI 运行时。右侧标签随 Harness 会话管理，宿主提供全屏、分栏和浮动。纯终端客户端通过 MCP 读写内容，交付时提供实际页面链接或 HTML。若工作台连接失败，完全退出 Harness，在 ShowAI「设置 → Agent 插件」为 DeepSeek Harness 点「更新并启用」，再打开 Harness。

此插件声明 `SHOWAI_HOST_DISPLAY=fragment-file`。show_component 使用 `delivery:"auto"`。插件会自动读取 show_component、page_present 和 render_document 返回的本机 delivery.inline（缺省时读取 delivery.html），缓存文件并在工具结果旁显示预览。

Agent 不需要输出展示指令，也不需要重写或复制 HTML。页面超出对话预算时（嵌入图片是常见原因）结果没有 delivery.inline，只带 `inlineError`，预览改读体积更大的 delivery.html；需要在对话里看清重点时，用 page_read 的 `detail:"outline"` 取得块 ID，带一到三个关键块的 blockIds 再调用一次。最终回复只补充必要解释；有正式 Page 时给出实际项目与 openUrl。检查工具结果旁的预览是否出现，不以文件已生成代替显示验证。

没有预览时检查 ShowAI 插件的预览部分与 MCP 部分是否都已启用，核对工具是否返回真实本机文件以及宿主错误。保留源 Page 和可用 HTML 文件，不套用其他宿主的引用语法。远程 URL 不能交给本机文件适配器；按远程连接实际支持的视图交付。

# Codex 展示适配

此插件默认使用 Codex 的 MCP Apps 原生视图，声明 `SHOWAI_HOST_DISPLAY=mcp-app`。show_component 使用 `delivery:"auto"`；工具调用后由宿主直接展示组件，无需等待最终回复，也无需追加 visualize 文件引用。page_present 和 render_document 同样使用附带的阅读器；正式页面仍先保存再展示。

## 工作台与对话选区

支持 Plugin Extensions 的 Codex 桌面端可以从主侧栏打开 ShowAI 工作台，也可以在当前聊天右侧打开 ShowAI 页面编辑器。用户在编辑器选择「引用到 Codex 对话」后，下一条消息可携带项目、页面、版本及内容对象的 `showai.reference`。根据该引用读取和修改原页。引用缺少页面或选区时，请用户在右侧定位对象并引用，或使用 ShowAI 的「复制引用」。用户可以在主侧栏的工作台中搜索并打开已保存的 Page，也可以从选区发起 Codex 草稿。然后在新对话右侧打开 ShowAI，按页面选择器定位同一页。消息中的阅读预览继续按展示工具交付。

用户要在回复里给出可点击、在 Codex 右侧打开的已保存页面时，先确认真实项目和页面，再调用 `workbench_page_reference({projectId,pageId})`。用页面标题作为链接文字，链接指向回执的绝对 `path`。引用文件只含页面身份，Codex 打开该文件时 ShowAI 读取内容库里的原页。打开动作由实际宿主处理，生成文件回执不能证明右侧已经打开。未提供此工具的连接可以在回复中给出已有页面的 `openUrl`。

## 分批生成

用户要求边生成边看，或任务中的内容会分批到达时，按 show-visual 的持续更新流程调用 `show_component({kind,data,live:true})`。第一批内容须完整合法并有实际信息，后续使用同一个 viewId 和块 ID 调用 show_component_update，最后 complete:true。读取器自动读取新版本，不启动模型回合。内容已齐或小任务可直接一次展示，不为了流式效果拆成逐字调用。

先看 capabilities.presentation.liveUpdates；本机 stdio 支持持续更新，HTTP 连接仍完整交付。旧插件若回显 codex-visualize，在支持 MCP Apps 的 Codex 中显式传 `delivery:"mcp-app"`，无需仅为展示改内容库。liveUpdates.available 说明服务端入口可用，宿主是否实际显示和能否回调另行核对。

最终回复只补充结论。原生组件已经出现时，不再追加同一内容的文件式展示。工具成功、资源附带、用户实际看到是不同证据；电脑操控的 MCP Apps 标签页列表只列出已展开的侧栏视图，列表为空不能判定 inline 未显示。无法直接检查 inline 时，请用户确认画面或展开到侧栏，不重复生成多张图来验证。

## 不支持 MCP Apps 的入口

只有实际确认宿主不能显示 MCP Apps，或用户明确要求文件式展示时，使用 `show_component({kind,data,delivery:"fragment-file"})`，不传 live。使用返回的 delivery.inline 绝对路径，在最终回复中单独一行写：

```text
visualize{"path":"实际返回的绝对inline文件路径"}
```

文件式交付不持续更新。page_present、render_document 的本机 delivery.inline 也可作为该入口的完整交付。URL 不是本机路径；不要把 delivery.html 写进 visualize 引用。

页面超出对话预算时，查看 inlineError，用 page_read 的 detail:"outline" 取得块 ID，再选一到三个独立可理解的关键块展示，并提供整页 openUrl。单个块仍超限时保留完整 HTML 与源页面入口。更新中断或宿主不支持 serverTools 时保留最后有效内容，按 show-visual 排查和读回保存，不宣称持续更新成功。

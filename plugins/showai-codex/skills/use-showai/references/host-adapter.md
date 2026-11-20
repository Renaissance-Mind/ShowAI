# Codex 展示适配

## 本轮结果怎样交付

本机 Codex 插件声明 `SHOWAI_HOST_DISPLAY=mcp-app`。以下调用以当前连接实际提供的工具为准。

| 用户要的结果 | 在 Codex 中的交付 |
| --- | --- |
| 在聊天里看图、比较或试用组件 | 按 show-visual 用 `show_component`（`delivery:"auto"`）内嵌展示。临时展示无需建页。 |
| 新建作品、修改已有页，或把刚才的组件保存成页 | 从本轮最终保存回执核对项目和原页，保存成功后用同一连接调用一次 `card_present`。新建和续改都默认发卡片，读者点击时才打开页面。 |
| 明确要在消息里阅读已保存页面的正文或片段 | 用 `page_present` 的阅读器。要看指定片段时传对应的 `blockIds`。用户同时要卡片和预览时再交付两者。 |
| 只要文件 | 导出已保存的作品用 `page_export`。直接生成完整独立文件且无需入库时用 `render_document`。 |

用户明确要求只保存、只导出文件或直接打开页面时，按指定方式交付。只做规划、只查资料或保存失败时，按实际完成的工作回复。卡片工具仅用于当前连接可读取的已保存页面。连接缺少 `card_present` 时，沿用[通用交付](host-display.md#通用交付)。用户专门要卡片时说明该连接的限制。保存成功但发卡失败时报告两项结果，给出已有的页面位置。

## 工作台与对话选区

支持 Plugin Extensions 的 Codex 桌面端可以从主侧栏打开 ShowAI 工作台。用户也能在聊天右侧打开 ShowAI，使用页面选择器为这个标签选定一页。用户在编辑器选择「引用到 Codex 对话」后，下一条消息可携带项目、页面、版本及内容对象的 `showai.reference`。按[用户引用](user-references.md)核对目标和版本。用户给出可唯一识别的页面或组件时，也可查找页面并读大纲。定位仍有歧义时，请用户引用右侧对象或使用 ShowAI 的「复制引用」。从全局工作台的选区可发起 Codex 草稿，再在新聊天中打开对应页。消息中的阅读预览按展示工具交付。

交付已保存的作品，或用户索取指定页面或组件的卡片时，调用 `card_present({projectId,pageId})`。卡片显示页面标题和完整路径。用可选的 `description` 告诉读者新页里有什么、这次修改了什么，最多 1000 个字符。整页交付用页面身份。要带读者直达改动的组件时，从保存后的 `page_read` 大纲（`detail:"outline"`）取真实的 `blockId`。省略说明时，组件卡片正文显示组件标题。

同一页在一轮里保存多次，交付最终结果的一张卡片。一轮完成多页，或用户明确要多张页面、组件卡片时，第一张放在顶层，其余按顺序放入同一次调用的 `additionalTargets`。每项可独立传 `projectId`、`pageId`、`blockId` 和 `description`。部分页面保存失败时，卡片只指向已成功保存的结果，回复中说明其余页面的状态。

用户要手动调节卡片间距时，在同一次 `card_present` 调用的顶层传 `adjustSpacing:true`。滑块直接作用于本组卡片；点击「采用这组间距」把选定的像素值送回当前聊天。普通卡片使用默认布局。

点击「侧边打开」，在聊天右侧打开原页并定位到所选组件，已有同页标签时直接跳转。聊天里的卡片会保留，可继续点击其他卡片。按钮旁的小箭头可选「从工作台打开」或「从 ShowAI App 打开」，两个入口都携带该卡片的页面和组件位置。

用户说「帮我打开」「跳到那个组件」时，先调用 `card_navigate`，传相同的目标。返回 `accepted` 表示显示同一原页的编辑器已接收跳转，`superseded` 表示有更新的跳转请求。返回 `unavailable` 时调用 `card_open`，让 Codex 在独立标签中展开目标页。看到原页后才能确认打开的位置。找不到指定组件时重新读取大纲核对。

用户专门要引用文件时，调用 `workbench_page_reference`，传相同的页面或组件目标，用标题链接到回执的绝对 `path`。路径有空格时用尖括号包住链接目标。Codex 管理文件查看器的选择提示。旧连接只有此工具时也可以用它交付文件。若连接只提供页面的 `openUrl`，说明该链接会在 ShowAI App 中打开。

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

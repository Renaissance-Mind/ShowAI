# Antigravity 展示适配

<!-- showai-host-delivery:start -->

- 临时组件用 `show_component` 的 `delivery:"auto"` 在 MCP Apps 原生视图直接展示。视图已挂在工具调用处，回复只补充图中的结论，**不要再输出 `<agent-embed>` 或复制 `.inline.html`**。
- 新建或续改保存成功后，用最终回执的项目和页面 ID 调用 `card_present` 交付原页卡片；同一页只交付一次，多页放入同一次调用的 `additionalTargets`。
- 用户明确要求在消息里阅读原页或片段时用 `page_present`（按需传 `blockIds`）；要求在右侧/侧栏工作台打开页面或跳到某组件时用 `card_navigate`。缺少卡片工具或原生视图未出现时查完整宿主适配。

<!-- showai-host-delivery:end -->

Antigravity App 的插件区提供 **ShowAI Workbench** 全局入口，用来浏览项目并继续编辑。当前任务的右侧原页和 `.showai-ref` 文件仍通过任务侧边入口打开。

## 本轮结果怎样交付

本机 Antigravity 插件声明 `SHOWAI_HOST_DISPLAY=mcp-app` 与 `SHOWAI_ANTIGRAVITY_WORKBENCH=1`，并在右侧 Auxiliary Pane 内置实时 **ShowAI 工作台 Sidecar**（`sidecar://showai/workbench/`）。以下调用以当前连接实际提供的工具为准。

| 用户要的结果 | 在 Antigravity 中的交付 |
| --- | --- |
| 在聊天里看图、比较或试用组件 | 按 show-visual 用 `show_component`（`delivery:"auto"`）在 MCP Apps 原生视图内嵌展示，临时展示无需建页。 |
| 新建作品、修改已有页，或把刚才的组件保存成页 | 从本轮最终保存回执核对项目和原页，保存成功后用同一连接调用一次 `card_present` 交付原页卡片。 |
| 在右侧打开已保存页面或跳转到某个组件 | 调用 `card_navigate`；面板未打开返回 `queued` 时附上 `sidecar://showai/workbench/...` 胶囊。 |
| 明确要在消息里阅读已保存页面的正文或片段 | 用 `page_present` 的 MCP Apps 阅读器，看指定片段时传对应的 `blockIds`。用户同时要卡片和预览时再交付两者。 |
| 只要文件 | 导出已保存的作品用 `page_export`；直接生成完整独立文件且无需入库时用 `render_document`。 |

当回执的 `delivery.mode` 为 `mcp-app` 时，视图资源已经随工具结果交给宿主。根据宿主状态或用户反馈确认是否显示。显示成功时沿用工具调用中的视图；加载失败时按完整宿主适配选择一个可用的交付入口。

连接缺少 `card_present`（例如旧版运行时）时，给出项目名称与可用的 `openUrl`。已确认宿主侧栏工作台可用时，可以用实际页面身份构造 `[在 ShowAI 工作台打开《页面标题》](sidecar://showai/workbench/?project=<projectId>&page=<pageId>)`。

## 页面卡片与侧栏实时工作台

交付已保存的作品，或用户索取指定页面或组件的卡片时，调用 `card_present({projectId, pageId, blockId?, description?, additionalTargets?, adjustSpacing?})`：

- 卡片默认展示页面标题、项目与目录路径。可用可选的 `description` 总结新页看点或本轮改动（最多 1000 个字符）。
- 需要直达具体组件时，通过 `page_read`（`detail:"outline"`，仅靠大纲不足以区分块语义时用 `rendered:false, response:"source"`）核实真实的 `blockId` 传入；省略 `description` 时组件卡片正文显示组件标题。
- 同一页在一轮里保存多次只交付最终结果的一张卡片；一轮完成多页或需并列交付多张卡片时，第一张放在顶层，其余按顺序放入同一次调用的 `additionalTargets`（每项含 `{projectId, pageId, blockId?, description?}`）。
- 用户要求手动调节卡片间距时，在顶层传 `adjustSpacing:true`；普通卡片使用默认布局。
- 点击卡片本身，在右侧打开目标原页或组件。已打开的 ShowAI 工作台可直接定位到该位置。卡片右侧的菜单也提供工作台和 ShowAI App 的打开入口。

用户说「帮我在右侧打开这页」「跳到那个组件」时，调用 `card_navigate({projectId, pageId, blockId?})`（无需再额外调用 `card_present`）：

- 返回 `status: "accepted"` 表示工作台已接收定位请求。能观察宿主时，进一步核对原页是否打开。
- 返回 `status: "queued"` 表示右侧工作台面板当前未展开，跳转目标已暂存；此时在回复中附上侧栏胶囊 `[在 ShowAI 工作台打开《页面标题》](sidecar://showai/workbench/?project=<projectId>&page=<pageId>)`（定位块时附加 `&block=<blockId>`；未指定页面仅需打开工作台时用 `[打开 ShowAI 工作台](sidecar://showai/workbench/)`），用户点击胶囊展开侧栏后即自动落到目标位置。

收到用户从右侧工作台点击「引用到 Antigravity 对话」发来的引用（Artifact Comment / `showai.reference`）时，按[用户引用](user-references.md)提取其中的 `projectId`、`pageId`、`blockIds` 与版本基线，调用 `page_read` 核对后再执行修改或回答。

## 分批生成与回退路径

- **分批持续更新**适用于用户明确选用已有组件且当前宿主和连接都支持持续更新的场景。按 show-visual 调用 `show_component({kind, data, live:true, delivery:"mcp-app"})`，沿用同一 `viewId` 更新，最后传 `complete:true`。原创 HTML 按当前可用的展示方式一次交付。
- **超出内联预算**：当 `page_present` 出现 `inlineError` 或页面过大时，优先交付 `card_present`（侧栏工作台无内联体积限制，可完整交互查看与编辑）；确需在对话内嵌局部摘要时，用 `page_read`（`detail:"outline"`）选 1–3 个不含大图的关键块传 `blockIds` 再调 `page_present`。
- **仅当宿主明确无法显示 MCP Apps 或用户点名要求独立 Artifact 嵌入文件时**：才显式传 `delivery:"fragment-file"`，在确认 `display.reader === "bundled"` 后将 `delivery.inline` 复制到当前会话 `<Artifact Directory>` 下再输出 `<agent-embed src="file:///..."></agent-embed>`；不要手写或改写 ShowAI 生成的 HTML。

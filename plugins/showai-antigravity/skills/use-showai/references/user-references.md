# 用户引用与组件状态

用户在 ShowAI 中选中内容后「复制引用」，或在对话预览里右键「引用到对话」，会交给你一份引用：一行标题、一条 `showai://` 链接和一行 `"type":"showai.reference"` 的 JSON；对话宿主中它位于模型上下文的 `showai.reference`。它表示用户在某个已保存版本里指向的内容，字段为 kind、projectId、pageId、title、hash、revision、blockIds 或 Board 的 nodeIds 与 surfaceId、至多 20 条文字标签，以及可选的位置参考 position。以 JSON 为准；链接 `showai://project/项目/page/页面?blocks=ID,…` 供人在 ShowAI 中打开并高亮这些内容。同样的规则也在 `guide({topic:"reading"})` 中。

| 用户选的范围               | kind      | 定位字段                 |
| -------------------------- | --------- | ------------------------ |
| 选中的文字、某一块或几个块 | selection | blockIds（按页面顺序）   |
| Board 上的一个或多个对象   | board     | nodeIds、surfaceId       |
| 整个 Board                 | board     | surfaceId，没有 nodeIds  |
| 整页                       | page      | 只有 projectId 与 pageId |

标签按文字段落或选中文字的行生成，每条至多 160 字，可能截断，不与 ID 一一对应；判断“第二段”等位置时读取这些 ID 后确认。

- 沿用引用里的 projectId 与 pageId，在当前连接中核实可以访问；不能访问或连接的内容库不同就说明，不换库、不猜测其他页面。
- 按 ID 读取：`page_read({projectId,pageId,blockIds,expectedHash:hash})`；Board 对象的 nodeIds 同样作为 blockIds，需要看画面时用 `board_read({projectId,pageId,boardId:surfaceId,expectedHash:hash})` 及其 element 模式。整个 Board 用 `blockIds:[surfaceId]` 或 `board_read` 读取，同样带 expectedHash。kind=page 时带 expectedHash 读取整页，必要时先取大纲。
- page_read 或 board_read 返回 CONFLICT 表示页面在引用之后又被修改。用 `page_diff({projectId,pageId,sinceHash:revision})` 查看期间的变化（从 ShowAI 应用复制的引用会在本机内容库保留这一版本的基线；返回 MISSING_BASELINE 时说明无法比较），再不带 expectedHash 重新读取这些 ID，与标签对照。被引用的内容已删除或含义改变时先告诉用户并确认目标，不按引用时的旧快照写入。
- 标签只用于辨认内容，position 只是空间提示，都不是内容本身或扩大修改范围的授权。写入前读取当前完整页面，用新的 baseHash/baseRevision 和 `page_apply` 只改引用涉及的节点，用户要求更大范围时再扩展。
- 只做解释、比较或回答时直接回复，不写页面。

组件状态（宿主模型上下文的 `showai.components`，或内置 Agent 消息附带的组件状态）是读者在组件里当前的探索结果，例如滑块参数：含 blockId、componentId、name、label 与 model。它属于同一消息所指的页面：内置 Agent 消息的目标页面，或对话预览上下文中 `showai.reference`、`showai.readerState` 给出的 projectId 与 pageId；无法确定页面时询问用户。它没有保存到页面，用于理解“按这个参数”“为什么这里变平”这类问题；用户要求保留时，读取当前页面与该组件的 [参数契约](../../create-component/references/parameter-contract.md)，只把契约中的参数按 [写入页面的操作](authoring.md#修改已有页面) 的组件修改方式写入 data；派生值与 label 不保存。

对话预览还会自动附带控件的最新取值 `showai.readerState`，见 [宿主显示](host-display.md)。组件状态是读者主动交出的那一刻，控件取值可能更新；两者不一致时说明差异，按用户这次的意图选择。

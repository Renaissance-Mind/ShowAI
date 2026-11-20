# Antigravity 展示适配

此插件面向 Antigravity 2.0，声明 `SHOWAI_HOST_DISPLAY=fragment-file`，同时内置 **ShowAI 侧栏工作台 Sidecar**（`sidecar://showai/workbench/`）与 **预览自动暂存 Hook**。

## 1. 侧栏实时工作台（推荐用于已保存页面与深度编辑）

ShowAI 在 Antigravity 右侧 Auxiliary Pane 运行完整实时工作台，支持直接编辑、浏览项目、自动关联当前打开的代码仓库，并支持把选区或组件一键「引用到 Antigravity 对话」。

- **新建或修改已保存页面后**：在回复中给出侧栏直达胶囊（指向当前保存的 `projectId` 与 `pageId`，定位到具体块时附加 `&block=<blockId>`），同时给出项目名称与 `openUrl`：

  ```markdown
  [在 ShowAI 工作台打开《页面标题》](sidecar://showai/workbench/?project=<projectId>&page=<pageId>)
  ```

- **用户要求“打开 ShowAI”“打开这页”“跳到那个组件”时**：直接输出对应的 `sidecar://showai/workbench/...` 胶囊（未指定页面时用 `[打开 ShowAI 工作台](sidecar://showai/workbench/)`）。
- **收到用户从侧栏发来的引用（Artifact Comment / `showai.reference`）时**：按 [用户引用](user-references.md) 提取其中的 `projectId`、`pageId`、`blockIds` 与版本基线，调用 `page_read` 核对后再执行修改或回答。

## 2. 对话内嵌视图（`<agent-embed>`）

Antigravity 对话内嵌视图禁止加载外部公共 CDN，只能呈现 `display.reader` 为 `bundled` 的自包含离线 HTML，且文件必须位于当前会话的 Artifact 目录（`<Artifact Directory>`）。

### 自动暂存（默认路径）

调用 `show_component`（`delivery:"auto"`）、`page_present` 或 `render_document` 后，插件内置 Hook 会自动检测 `bundled` 预览片段，将其包装为带 Antigravity 亮暗主题同步（`themechange`）的完整离线 HTML，写入 `<Artifact Directory>`，并在下一轮回复前把可直接使用的 `<agent-embed src="file:///..."></agent-embed>` 路径注入系统消息。

- **收到 Hook 注入的暂存路径时**：直接在回复中单独一行输出该 `<agent-embed>`，**不要再调用 `run_command` 执行 `cp`，也不要用 `read_file` / `write_file` 逐字转写**。
- **内嵌与侧栏的分工**：
  - **紧凑可视化**（`show_component` 1–5 个组件，或高度约 `<= 450px` 的局部高亮）：用 `<agent-embed>` 内嵌在对话中，方便直接查看与交互。
  - **完整长文档 / 多章节已保存页面**（`page_present`）：优先给出 `sidecar://showai/workbench/?project=<projectId>&page=<pageId>` 侧栏工作台胶囊与 `openUrl`；仅在页面本身很紧凑，或需要展示其中 1–3 个关键块（传 `blockIds`）时才在对话里叠加 `<agent-embed>`，避免把整份长文塞进窄小的滚动框。
  - `render_document` 额外给出完整离线文件 `delivery.html` 路径。

### 回退路径（未触发 Hook 或超出内联预算时）

- **Hook 未暂存但 `display.reader === "bundled"`**：用 `cp` 将 `delivery.inline` 原样复制到 `<Artifact Directory>/showai-preview.html`，再输出 `<agent-embed src="file:///实际复制后的Artifact绝对路径"></agent-embed>`。
- **`display.reader === "cdn"` 或存在 `inlineError`**：说明内联片段超出离线阅读器预算（常见原因是嵌入大图），`<agent-embed>` 无法联网加载阅读器。已保存页面直接给出 `sidecar://showai/workbench/?project=<projectId>&page=<pageId>` 胶囊（侧栏工作台无内联体积限制，可完整交互查看）、`openUrl` 与 `delivery.html`；确需对话内嵌摘要时，用 `page_read`（`detail:"outline"`）选 1–3 个不含大图的关键块带 `blockIds` 再调一次 `page_present`。

不要手写或改写 ShowAI 生成的 HTML，不把未经暂存到 Artifact 目录的临时路径直接写进 `<agent-embed>`，也不输出其他宿主的展示指令。工具调用、文件暂存与实际显示分别核对；正文只补充必要结论。

# 在 Agent 对话中展示 ShowAI 内容

展示方式与远程同步独立。使用已有项目时先核对保存与同步，独立展示使用 render/render_document 的结果。只在宿主支持时发送 inline；无 inline 的 Agent 仍可操作项目并返回回执。不能因为缺少显示能力而要求用户更换 harness。

## 按实际能力交付

| 宿主能力 | 交付方式 |
| --- | --- |
| MCP Apps | render_document 展示本轮内容，page_present 展示已授权项目页面；工具返回关联的阅读器，宿主负责显示。 |
| Codex 对话可视化 | 使用实际返回的本机 inline 路径，按下面的引用契约呈现。HTTP 交付是 URL 时，先通过宿主允许的文件工具取得内容再呈现。 |
| 其他 HTML / Widget / artifact 能力 | 读取当前宿主的实际展示协议，把对应 HTML/inline 传入该协议。不得假设支持 Codex 引用格式。 |
| 没有 HTML 显示能力 | 独立展示交付 HTML 与源文件；项目操作交付项目、页面标题/ID、修改摘要和同步状态，用户在 ShowAI 阅读。 |

公共目录、组件定制和模板应用都可用于不同步的独立展示。CLI render 返回 delivery.html/inline/source；HTTP 返回有期限的地址和 MCP Apps 阅读器。过期后重新渲染；需要长期保存时交付源文件或写入用户选择的项目。MCP Apps 的阅读器随工具结果由宿主直接呈现，下载 HTML 不是显示前提。执行环境无法下载 HTTP 地址时，独立渲染的源输入可用 presentation_source 通过 MCP 分片取得；按 nextOffset 拼接 text 后保存 JSON。工具成功不等于界面已显示。

## Codex 对话展示

对话预览是 ShowAI 页面交付的一部分，创建独立页面或文件的任务也执行这个默认步骤。当前会话有 visualize 技能时，按需核对其中的片段格式、路径和输出引用契约；ShowAI 技能决定交付时机与展示内容。ShowAI 负责生成 inline 片段，Agent 负责把它引用到最终回复。使用本次会话可写、持久的输出目录；优先使用宿主提供的会话可视化目录。

```sh
showai export --project PROJECT --page PAGE --format inline --components bundled --presentation reading --out /ABSOLUTE_SESSION_OUTPUT/report-inline.html --json
```

读取成功返回的 `path` 对应文件，确认它是可用的 HTML 片段，并检查导出的交互。当前 Codex 的引用格式如下；使用实际返回的绝对路径，在本轮最终回复输出：

```text
visualize{"path":"/ABSOLUTE_SESSION_OUTPUT/report-inline.html"}
```

该引用触发对话内呈现。`open_in_codex` 打开预览面板用于检查；完整 HTML 的文件链接用于下载或完整阅读。在当前宿主支持 Codex 对话可视化且用户需要展示时，最终回复包含实际引用。用户指定只保存/只交付文件/面板展示/后台执行，或宿主缺少该能力时，采用上面的对应交付分支。

## 内容过大与局部展示

独立渲染使用传入 document 的节点 ID，通过 render_document.blockIds（CLI render 的输入 JSON 同名字段）选择预览部分；完整 HTML 与源文件仍保留整页。完整 inline 超限时回执保留 HTML/源文件并返回 inlineError，选取较小区域重试展示，无需创建个人项目。

项目页面的当前 inline 上限为 1 MB，按实际 inline 导出返回的 `bytes` 判断。先尝试完整页面 inline 导出；运行时按本页组件及依赖编译阅读器，并在能减小体积时无损压缩代码、样式和页面包，完整 HTML 的大小不代表 inline 大小。只有实际 inline 导出仍超限时，读取最新完整页面，从 `document.content` 获取区域或组件节点的 `attrs.id`，选择保留必要说明、结论和交互的区域：

```sh
showai export --project PROJECT --page PAGE --blocks SUMMARY_REGION,COMPARISON_REGION --format inline --components bundled --presentation reading --out /ABSOLUTE_SESSION_OUTPUT/report-preview.html --json
showai export --project PROJECT --page PAGE --format html --components bundled --presentation reading --out /ABSOLUTE_SESSION_OUTPUT/report.html --json
```

引用局部片段，并附完整报告链接，说明当前展示的范围。需要多个片段时按阅读顺序导出；导出选区不增加存储中的 page，也不替换完整源文件。自定义组件内部的章节只有成为页面节点才能被 `--blocks` 选择；单个组件过大时缩减预览数据或图片、制作同一页面中的独立摘要区域，保留完整组件供完整报告阅读。不要为了展示限额另建内容项目或把报告章节拆成独立资源。

## 交付检查

根据实际展示能力核对：支持 inline 时包含本轮有效引用；MCP Apps 核对阅读器已呈现；无 inline 时独立展示交付文件，项目操作交付保存与同步回执。导出文件或调用工具本身不证明已显示。

## 其他宿主

按该宿主提供的显示工具或协议传递 inline 内容。缺少对话 HTML 呈现能力时，独立展示交付 HTML/源文件；项目操作交付项目、页面和同步结果，无需为完成写入额外导出 HTML。用户要求外部预览时再使用可用入口。安装 MCP 或 @ 桌面应用本身不建立对话 HTML 呈现能力。

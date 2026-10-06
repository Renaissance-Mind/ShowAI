# 在 Agent 对话中展示 ShowAI 内容

用户要求展示页面、对比结果或修改效果时，先保存完整项目页面，再选择当前宿主支持的呈现方式。普通报告继续保存在一份 Page 中，展示片段对应这份源页面的区域或组件。

## Codex 对话展示

当前会话有 visualize 技能时，读取其完整说明并遵循宿主的最新输出契约。ShowAI 负责生成 inline 片段，Agent 负责把它引用到最终回复。使用本次会话可写、持久的输出目录；优先使用宿主提供的会话可视化目录。

```sh
showai export --project PROJECT --page PAGE --format inline --components bundled --presentation reading --out /ABSOLUTE_SESSION_OUTPUT/report-inline.html --json
```

读取成功返回的 `path` 对应文件，确认它是可用的 HTML 片段，并检查导出的交互。当前 Codex 的引用格式如下；使用实际返回的绝对路径，在本轮最终回复输出：

```text
visualize{"path":"/ABSOLUTE_SESSION_OUTPUT/report-inline.html"}
```

该引用触发对话内呈现。`open_in_codex` 打开预览面板用于检查；完整 HTML 的文件链接用于下载或完整阅读。展示请求的最终回复应包含实际对话引用，可附一段必要说明与完整报告链接。只有用户明确要求文件、预览面板或其他交付位置时采用其指定方式。

## 内容过大与局部展示

当前 inline 上限为 1 MB。文件过大时读取最新完整页面，从 `document.content` 获取区域或组件节点的 `attrs.id`，选择保留必要说明、结论和交互的区域：

```sh
showai export --project PROJECT --page PAGE --blocks SUMMARY_REGION,COMPARISON_REGION --format inline --components bundled --presentation reading --out /ABSOLUTE_SESSION_OUTPUT/report-preview.html --json
showai export --project PROJECT --page PAGE --format html --components bundled --presentation reading --out /ABSOLUTE_SESSION_OUTPUT/report.html --json
```

引用局部片段，并附完整报告链接，说明当前展示的范围。需要多个片段时按阅读顺序导出；导出选区不增加存储中的 page，也不替换完整源文件。自定义组件内部的章节只有成为页面节点才能被 `--blocks` 选择；单个组件过大时缩减预览数据或图片、制作同一页面中的独立摘要区域，保留完整组件供完整报告阅读。不要为了展示限额另建内容项目或把报告章节拆成独立资源。

## 其他宿主

按该宿主提供的显示工具或协议传递 inline 内容。缺少对话 HTML 呈现能力时，打开可用的预览并返回完整 HTML 文件或预览地址，清楚说明展示位置。安装 MCP 或 @ 桌面应用本身不建立对话 HTML 呈现能力。

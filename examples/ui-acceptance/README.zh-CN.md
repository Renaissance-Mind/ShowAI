# 独立界面验收模板

[English](README.md)

复制整个目录，打开 [preview.html](preview.html) 即可试用。页面上默认标出当前可操作的控件，右侧提供对应的操作按钮、状态切换和可折叠的流程树。点树节点直接进入该状态，还可以继续操作实际界面。每个任务各自构建和交付这份 HTML。

```text
按独立界面验收模板交付本次改动。复用真实控件，标明模拟的数据或服务。
把关键的起点、分支、确认、取消和恢复映射为可直达状态。保留控件上的编号、当前操作列表和可跳转的流程树。
检查从树跳入后能在真实控件上继续操作，手动改变界面时状态、操作和编号也要跟随。
在本会话给出所测版本、预览入口、怎么试及实际结果。失败时附预期、实际和证据。
```

**接入网页。** 参考 [search.html](search.html)，在任务自己的应用页面里声明 `window.reviewScenario = { entry, states }`。每个状态用 `id`、`title` 和 `parent` 表示树上的位置，`match()` 读取实际界面，`enter(ui)` 准备目标状态，`actions` 写成 `[{title, target}]`。`target` 是 CSS 选择器或返回当前控件的函数。编号和右侧按钮都调用这个控件。可用 `group` 分组、`variants` 指定相关状态，重叠状态优先选更深的节点，必要时用 `priority` 指定优先级。

每次直达会创建新的预览帧，再调用 `enter`。异步界面可以用 `await ui.click(target, label)`、`ui.fill(target, text, label)` 或 `ui.wait(predicate, label)` 等待前置操作。应用可读取帧名 `ui-review/<id>` 准备独立示例数据。直接操作沿用当前帧和数据。

在本目录运行 `node pack.mjs search.html preview.html` 可重建样例。自己的应用先生成自包含网页，再用同一命令包装。也可从 [pack.mjs](pack.mjs) 导入 `buildReview(appHtml, {title, lang})`。成品内嵌应用、标注和流程树，可单文件交付。原生端沿用自己的运行和测试环境，交付该端可操作的入口与证据。

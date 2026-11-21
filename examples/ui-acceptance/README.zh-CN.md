# 独立界面验收模板

[English](README.md)

复制整个目录，打开 [preview.html](preview.html) 即可试用。页面标出当前控件，右侧提供操作按钮、状态切换和可折叠的流程树。点树节点进入该状态并继续操作。地址中的 `#state=状态ID` 可直接打开对应状态，`?marks=0` 可在查看外观时收起编号。

点「流程画布」可查看所有状态的界面缩略图和操作连线。用分组按钮定位流程，或点「全图」查看所有状态。点缩略图进入对应状态，点「返回」或按 Escape 回到刚才的预览，继续操作。链接加上 `?flow=1` 可直接打开画布。

GitHub 可以收录验收工具、可复用的回归场景和通用示例。每次任务的验收页、操作记录、截图、日志和检查报告保存在本机任务目录。

```text
按独立界面验收模板交付本次改动。复用真实控件，标明模拟的数据或服务。
把关键的起点、分支、确认、取消和恢复映射为可直达状态。保留控件上的编号、当前操作列表和可跳转的流程树。
声明触发界面状态跳转的实际操作，交付包含全部状态缩略图和这些连线的流程画布。
检查从流程树或画布跳入后能在真实控件上继续操作，手动改变界面时状态、操作和编号也要跟随。
在本会话给出所测版本、预览入口、怎么试及实际结果。失败时附预期、实际和证据。
```

**接入网页。** 参考 [search.html](search.html)，声明 `window.reviewScenario = { entry, states }`。状态用 `id`、`title` 和 `parent` 表示树的位置，`match()` 读取实际界面，`enter(ui)` 准备状态，`actions` 写成 `[{title, target}]`。目标为 CSS 选择器或返回当前控件的函数。编号和右侧按钮调用该控件。用 `group` 分组、`variants` 指定相关状态，重叠时优先选深层节点，也可用 `priority`。可从 [targets.mjs](targets.mjs) 导入控件查找方法。设置 `discoverActions: true` 会补充有名称的可见控件，也可以省略手写操作列表。它也接受筛选控件的函数，状态可覆盖该设置，`data-review-ignore` 从自动发现中排除控件。

每次直达会创建新的预览帧，再调用 `enter`。应用可读取帧名 `ui-review/<id>` 准备状态，并自行保存要跨帧延续的数据。用 `dataSource` 说明数据来源，用 `preparation` 说明本次跳转调整的内容。异步界面可用 `ui.click(target, label)`、`ui.fill(target, text, label)` 和 `ui.wait(predicate, label)`。编号按钮通过程序点击真实控件，鼠标、键盘、拖动与原生行为还需实际操作验证。

**检查。** 当应用针对 `ui-review-check/<id>` 提供隔离数据且准备过程无持久副作用时，设置 `checkIsolation: true`。页面的「检查流程」会在独立帧逐项准备状态并核对目标，成功项可展开查看控件，失败项直接显示原因。条件性操作设置 `optional: true`。「动效观察」记录当前系统动态偏好、动画事件和前台帧间隔；分别在正常和减少动态效果下操作，帧间隔是观察数据。

**流程画布。** 在可隔离的场景中设置 `checkIsolation: true`，并在 `reviewScenario.transitions` 中声明 `{ from, to, label, kind? }`。两端使用现有状态 ID，`label` 写出触发操作。`kind` 支持 `forward`、`back` 和 `error`。单状态场景可以声明空数组。

**打包。** 自己的应用先生成自包含网页，再运行 `node pack.mjs app.html preview.html --source <ShowAI 源码目录> --title <标题> --lang zh-CN --data <数据说明>`。打包默认包含流程画布。打包器使用源码目录中安装的依赖和无头 Chromium，逐个准备隔离状态并将实际截图嵌入同一个 HTML。`--source` 省略时使用当前目录。也可调用 `buildReview(appHtml, { source, title, lang, metadata })`，采用同样的默认方式。

打包器检查常见 HTML 和 CSS 外部资源，并写入源码分支、提交、未提交状态、时间与内容指纹。运行时动态请求仍需实际验证。仍无法隔离状态的旧场景可用 `--no-flow`，代码调用则传入 `flow: false`。原生端继续使用本端的运行和测试环境。

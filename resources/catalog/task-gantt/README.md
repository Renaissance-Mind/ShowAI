# 任务管理甘特图

独立 React 组件包，入口接收 `{ data, onChange, readOnly }`。版本 `1.1.1`。

`data` 包含 `title`、可选 `description`、可选 `columns` 和最多 200 个 `tasks`。每个任务需要唯一 `id`、`title`、`start`、`end`（`YYYY-MM-DD`）和整数 `progress`（0–100）；可选 `owner`、`phase`、`dependencies`（前置任务 ID）、`milestone` 及 `parentId`（父任务 ID）。日期按整天计算，包含结束日，项目跨度最多 10 年。

默认行高 32px，任务条高 26px，任务与字段保持同一行。`columns` 是有序字段数组，以 `title` 开头；可选 `owner`、`status`、`phase`、`progress`、`start`、`end`。默认显示任务、负责人和状态；显示列设置支持增减和排序，编辑模式经 `onChange` 保存，阅读模式只调整当前视图。窄屏保留任务树，字段详情可点击任务查看。

`parentId` 支持多层分类与任务拆分，树形视图可展开、收起。搜索和状态筛选保留命中任务的祖先，自动展开匹配路径。父任务的起止日期与进度由所有叶子任务等权汇总，每个叶子只计一次；总任务数和平均进度也按叶子计算。拖动父任务可整体移动后代，父任务不支持独立调整两端或修改汇总进度。编辑表单可改变父任务，不能选择自身、后代或里程碑；删除父任务会将直接子任务提升一层并保留更深结构。

支持搜索、状态筛选、全览 / 日 / 周时间尺度、时间导航、任务详情。编辑态支持新建、编辑、删除、添加子任务、标记完成、拖动改期及拖动两端调整日期。键盘用户可使用编辑表单调整日期。里程碑只有一个日期。前置任务须在当前任务开始之前结束，日期重叠会显示依赖冲突；循环依赖和循环嵌套不能保存。删除任务会清除其他任务对它的依赖。

所有编辑经 `onChange(nextData)` 返回，由宿主保存。`readOnly: true` 保留浏览功能并隐藏数据修改入口。不会自动移动后续依赖任务。里程碑计入叶子任务进度。

## 导入和预览

使用当前 ShowAI CLI：

```sh
showai catalog import --project PROJECT --input resources/catalog/task-gantt --json
```

仓库内生成使用同一份组件代码的可编辑预览：

```sh
node scripts/preview-task-gantt.mjs /absolute/path/task-gantt.html
npx vitest run src/core/task-gantt.test.ts
```

输出包含对话内 fragment 和独立 HTML。示例数据位于 `examples/task-gantt/data.json`。Codex 预览编辑保存在当前可视化状态中；正式页面通过 ShowAI 的 `onChange` 保存。

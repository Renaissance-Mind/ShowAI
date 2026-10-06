# 任务管理甘特图

独立 React 组件包，入口接收 `{ data, onChange, readOnly }`。版本 `1.0.1`。

`data` 包含 `title`、可选 `description` 和最多 200 个 `tasks`。每个任务需要唯一 `id`、`title`、`start`、`end`（`YYYY-MM-DD`）和整数 `progress`（0–100）；可选 `owner`、`phase`、`dependencies`（前置任务 ID）及 `milestone`。日期按整天计算，包含结束日，项目跨度最多 10 年。

支持搜索、状态筛选、全览 / 日 / 周时间尺度、时间导航、任务详情。编辑态支持新建、编辑、删除、标记完成、拖动改期及拖动两端调整日期。键盘用户可使用编辑表单调整日期。里程碑只有一个日期。前置任务须在当前任务开始之前结束，日期重叠会显示依赖冲突；循环依赖不能保存。删除任务会清除其他任务对它的依赖。

所有编辑经 `onChange(nextData)` 返回，由宿主保存。`readOnly: true` 保留浏览功能并隐藏数据修改入口。不会自动移动后续任务。平均进度按任务等权计算，含里程碑。

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

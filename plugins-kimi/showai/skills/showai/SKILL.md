---
name: showai
description: 当用户要求在 Kimi Work 中创作、修改、展示或导出 ShowAI 页面时使用。连接本机 ShowAI 运行时，按 guide 创作 Page，导出 HTML，并用 Widget 小组件把交互预览投射到对话内。触发词：ShowAI 页面、展示页面、导出 inline、交互页面、报告页面。
---

# ShowAI（Kimi Work 路径）

ShowAI 把内容组织成可阅读、可探索的交互页面（Page/Board + 组件 + 模板）。本技能负责：**核实运行时入口 → 定位项目与页面 → 创作或修改 → 导出 HTML → 在 Kimi 对话内以 Widget 展示**。同一仓库 `plugins/showai/skills/` 下的文档（show-document / create-component / create-template / use-showai）含有更细的页面创作、组件与模板规范，需要深入时直接读取那些文件。

## 1. 运行时入口（每次任务必须先核实）

CLI 入口不固定，每次新任务重新核对，不沿用旧路径：

1. 在 ShowAI 仓库根（本插件随仓库分发，仓库根即含 `package.json` 的目录）运行 `npm run dev:status`，取返回 JSON 的 `cli.command`、`cli.args`、`cli.env`（含 `SHOWAI_HOME` 内容库路径）。
2. `ready` 为 false 时执行 `npm run dev:open -- --no-focus` 启动（复用已有进程），再次核对状态。
3. 下文所有 `showai` 命令 = `<cli.command> <cli.args…>`，并带上 `cli.env` 中的环境变量。

## 2. 定位项目与页面

用户指定了项目/页面时直接用其 ID。未指定时按 `guide workspace` 在 `SHOWAI_HOME` 内容库中解析项目；已有内容先 `showai pages list` / `showai search --query` 定位，再 `pages read` 读取（默认结构化 JSON；视觉问题用图像视图，交互问题用 HTML 视图；细节见 `guide reading`）。长页面先用 `--detail outline` 拿组件与区域 ID，再按 `--blocks` 读局部。

## 3. 创作与修改

- 按任务读 CLI guide：普通创作 `guide authoring`；Page/Board 嵌套结构 `guide containers`；区域内部富文本 `guide document`；组件/模板的选择 `guide catalog`。
- 写入版本化内容库时必须同时传当前 `--base-hash` 与 `--base-revision`。返回 `error.saveFailed: true` 时本次保存失败：按 `recovery/nextStep` 读取当前版本比较后重新保存，或按用户要求放弃。**禁止只更新 hash/revision 后原样覆盖。**
- 修改已有页面先读当前版本、保留稳定节点 ID（attrs.id），后续局部展示沿用同一 ID。

## 4. 导出 HTML

先读 `guide export` 确认当前运行时支持的参数（尤其 `--blocks`、`--format inline|html`）。整页导出：

```sh
showai export --project PROJECT --page PAGE --format html --components bundled --presentation reading --out /ABSOLUTE_OUTPUT/report.html --json
```

对话内展示优先使用自包含的完整 HTML；`--format inline` 是供宿主内嵌的片段，若只有片段，写入 Widget 前先确认文件是完整 HTML 文档（含 `<!DOCTYPE` 或 `<html`），不是则补全文档骨架。**导出后必须实际读取返回 `path` 的文件头部确认内容可用。**

内容过大或只展示局部时，用页面节点的 `attrs.id` 做局部导出（选区包含全部子内容），并附完整页链接：

```sh
showai export --project PROJECT --page PAGE --blocks REGION_ID --format html --components bundled --presentation reading --out /ABSOLUTE_OUTPUT/preview.html --json
```

## 5. 对话内展示（Kimi Work 路径）

1. 先加载 `widget` 与 `widgetdesign` 技能，遵循其运行时契约与视觉规范。
2. 用 `Widget` 工具创建小组件，把第 4 步导出的完整 HTML 写入该 Widget 根目录下的 `workspace/index.html`（作为展示主界面；局部展示就把局部导出文件写入）。
3. 调用 `Widget.show` 把 `widgetView` 投射进当前对话，回复里配一段简短说明；完整 HTML 文件链接作为补充交付。
4. 更新已有页面时沿用同一 Widget 重写 `index.html` 后再次 `Widget.show`，保持同一展示入口。

降级与红线：

- 当前会话没有 Widget 能力时，不伪造展示：给出完整 HTML 文件的绝对路径链接，说明展示位置。
- **不要使用 Codex 的 `visualize` 引用协议**（`  visualize {"path":…} `），Kimi Work 不解析它。
- 不要在回复正文里粘贴整段 HTML；不要为绕过展示限额把报告拆成多份源页面。

## 6. 交付检查

最终回复必须包含本轮生成或更新的 Widget 卡片（或降级时的文件链接）与一句范围说明；涉及修改时说明改动位置。用户明确要求只保存、只交付文件或后台执行时，按用户指定方式交付，省略对话展示。

# 在 Codex 中使用 ShowAI

ShowAI 为 Codex 提供页面创作、内容阅读、组件开发和模板制作的工作流程。Codex 根据你的材料组织内容，通过 ShowAI 运行时保存页面；你可以在对话中查看支持的交互预览，也可以打开 ShowAI 工作台继续编辑。

## 准备环境

需要一个可以执行本机命令的 Codex 环境，以及可以访问的 ShowAI 桌面应用或独立运行时。插件提供 Skills 和参考说明，ShowAI 软件提供 CLI、阅读器和组件编译器，两者需要分别准备。

从源码安装时，先完成[快速上手](quick-start.md)中的依赖安装和构建。安装脚本还要求终端中可以执行 `codex` 命令；可以先用以下命令检查：

```sh
codex --version
codex plugin --help
```

Codex 插件由 Skills、工具连接等资源组成，具体可用能力取决于插件内容及运行环境。ShowAI 当前分发的是 Skills 插件。有关 Codex 插件机制，参见 [OpenAI 官方插件文档](https://developers.openai.com/plugins/build/plugins)。

## 安装插件

在 ShowAI 仓库目录执行：

```sh
npm run plugin:install
```

安装器准备插件包，通过 Codex 官方插件命令注册本地 marketplace 并安装 `showai@renaissance-mind`，随后核对已安装文件、版本和启用状态。它不会代替 ShowAI 软件构建或运行时安装。

检查插件状态：

```sh
codex plugin list --marketplace renaissance-mind --json
```

安装完成后，在 Codex 插件界面确认 ShowAI 已启用，并检查当前会话是否能识别 ShowAI Skills。若宿主仍显示旧能力，按宿主提供的刷新提示操作，再在新对话中确认。安装文件更新与会话实际加载是两个不同环节。

更新仓库中的插件后，执行：

```sh
npm run plugin:update
```

## 连接 ShowAI 内容库

### 使用桌面工作台或本地浏览器版

启动 ShowAI，打开「设置 → Agent」，在「本地连接」中点击「复制启动配置」，将配置提供给 Codex。配置包含可执行文件、CLI 参数和内容库环境变量，Agent 应按这些字段调用运行时。

ShowAI 启动时也会在选定内容库中登记 `agent-runtime.json`。默认内容库位于 `~/.showai`。使用自定义内容库时，提供该库的配置，确保 Codex 和工作台读写相同位置。

可以在 Codex 中发送：

> 使用 ShowAI。先核对我提供的启动配置和实际内容库，检查运行时能力，然后列出已有项目。

### 使用从源码构建的独立运行时

完成 `npm run build` 或 `npm run build:browser` 后，在仓库目录执行：

```sh
npm run runtime:register
node dist-runtime/scripts/cli.mjs runtime info --json
```

登记操作写入运行配置。`runtime info` 用于确认实际版本、内容库 `home`、存储模式、阅读器能力和可查询的指南。成功的 JSON 命令返回 `ok: true`；失败时应先处理报错。

如果明确使用自定义内容库，用同一个路径登记并查询：

```sh
node dist-runtime/scripts/cli.mjs runtime register --home /absolute/path/to/library --json
node dist-runtime/scripts/cli.mjs runtime info --home /absolute/path/to/library --json
```

将示例路径替换为实际内容库路径。CLI 每次调用结束后退出，通常不需要保持 ShowAI 窗口或本地浏览器服务运行。不要将插件安装目录当作 CLI 运行时目录。

## 创建第一份页面

说明内容目标、已有材料、保存归属和希望读者进行的操作即可。例如：

> 在 ShowAI 中新建「模型评估」项目。根据我提供的实验结果，创建一页评估报告：先写结论，再用表格比较配置，加入可切换指标的图表，并保留数据来源。保存后在对话中展示预览。

想使用已有项目时直接指定名称。没有指定项目时，ShowAI Skills 会根据可信的宿主工作目录定位或创建对应项目，同目录中的会话可以继续使用同一个项目。

如果名称可能重复，先让 Codex 查找并确认项目或页面 ID，再开始编辑。纯粹查找或阅读已有内容，可以这样请求：

> 找到「模型评估」项目中最新的评估报告，阅读结论和实验限制，告诉我还有哪些证据缺失。

## 继续修改和协作

页面保存在 ShowAI 后，可以直接在工作台中调整文字、数据和布局，然后让 Codex 继续处理：

> 继续修改「模型评估」里的报告。先读取我刚修改的版本，保留已有结论，只补充失败案例分析和下一轮实验计划。

Agent 正式写入前应读取完整页面，沿用稳定节点 ID，并以当前 hash 和 revision 保存。遇到冲突时，应重新读取、比较并合并，避免覆盖工作台中的新修改。

需要回顾变化时，可以请求：

> 比较这篇报告今天修改前后的版本，列出结论和实验数据的变化，先不要恢复。

历史恢复会生成一个新版本。项目同步和多人访问权限由 ShowAI Server 管理，详见[项目服务器与同步](project-sync.md)。

## Skills 如何分工

通常直接描述任务即可。需要明确指定工作流程时，可以使用当前 Codex 会话实际显示的 Skill 名称；插件前缀由宿主展示。

| Skill | 适合的请求 |
| --- | --- |
| `use-showai` | 连接运行时、查找和阅读项目、查询历史、管理同步 |
| `show-document` | 创建、修改、展示和导出页面，应用已有模板 |
| `create-component` | 创建或改造可复用 React 组件 |
| `create-template` | 创建模板，或从已经完成的页面中提取模板 |

例如，“为报告加入一个可调整学习率的实验”首先属于具体页面创作；现有组件无法表达所需交互时，再创建组件并将它应用到报告中。“把这份报告整理为每周都能使用的模板”则属于模板制作。Skill 的职责和配套参考文件见[插件说明](../plugins/showai/README.md)。

## 查看和交付结果

支持 HTML 可视化的 Codex 会话可以展示 ShowAI 导出的 inline 片段。Agent 保存页面后导出并通过宿主的展示方式呈现；只安装 ShowAI 插件并不保证所有 Codex 环境都有相同的对话展示能力。

完整页面较大时，可以预览选定章节或组件，并附完整 HTML。预览选区不会拆分原始页面。你也可以明确指定交付方式：

> 只展示这页的实验对比图和结论，完整页面保留在原项目中。

> 导出这篇报告为可以离线阅读的 HTML，并附上可重新导入的源文件。

> 将这个项目导出为带导航的静态网站。

导出文件是保存时的内容快照。后续修改应继续写入 ShowAI 源页面，并重新导出需要分享的版本。完整参数见 [Agent 使用说明](agent-usage.md)。

## 常见问题

| 现象 | 检查方法 |
| --- | --- |
| 插件已安装，但会话找不到 Skill | 检查插件是否启用、宿主是否已刷新，以及新对话中实际可见的能力 |
| 找不到 CLI 或启动路径失效 | 重新启动 ShowAI，或重新登记独立运行时，再取得当前启动配置 |
| Codex 看不到工作台中的项目 | 对比 `runtime info` 返回的 `home` 与工作台选定的内容库 |
| 页面保存冲突 | 重新读取当前页面并合并修改，保留尚未保存的草稿 |
| 对话没有交互预览 | 检查宿主是否支持 HTML 展示；使用完整 HTML 或工作台打开页面 |
| 新文档命令在旧运行时不可用 | 查询 `runtime info` 与对应 `guide`，按实际软件能力使用或更新软件 |

更多配置和操作协议见 [Agent 使用说明](agent-usage.md)及[运行入口与内容库](../plugins/showai/skills/use-showai/references/runtime.md)。

# CLI 脚本与运维参考

**语言：** [English](../agent-usage.md) | 简体中文 · [文档目录](index.zh-CN.md)

Agent 的文档操作使用 MCP，见 [Agent 接入](agent-integration.zh-CN.md)。本页面向脚本、服务配置、诊断与运维。CLI 每条命令完成后退出，可在桌面窗口关闭时运行；它与工作台使用同一内容库和保存保护。

## 使用正确的运行时

下面的 `showai` 代表经过核实的命令前缀，例如 `node /absolute/path/ShowAI/dist-runtime/scripts/cli.mjs`，不假设已安装全局 npm 命令。本机独立运行需要 Node.js 22.12+；桌面设置提供可使用内置 Electron 执行的完整配置。

本机插件通过所选内容库的 `agent-runtime.json` 发现软件，并调用 `runtime info --json` 核对能力。桌面启动会登记运行时；独立包可运行 `runtime register --json`。`--home /absolute/library` 或 `SHOWAI_HOME` 指定内容库，默认 `~/.showai`。

```sh
showai runtime info --json
showai guide --json
showai guide authoring --json
showai guide catalog --json
```

指南还包含 `workspace`、`containers`、`whiteboard`、`document`、`templates`、`versions`、`export` 和 `publish`。以当前运行时返回的操作形状和限制为准。JSON 成功返回 `{ "ok": true, "data": ... }`；失败返回 `ok:false`、错误码与原因并以非零状态退出，页面冲突退出码为 3。

## 项目与页面

用户指定的项目优先。`projects list` 是只读发现；`projects current` 会解析或创建宿主目录所属项目，不能用它代替只读查找。`--source-directory` 明确提供宿主目录；否则使用最近 Git 根目录或当前目录。路径会解析到真实绝对位置。

```sh
showai projects list --json
showai projects current --source-directory /absolute/host-project --json
showai pages create --project PROJECT --title "研究报告" --kind page --json
showai pages read PAGE --project PROJECT --json
showai pages diff PAGE --project PROJECT --since PREVIOUS_HASH --json
showai pages apply PAGE --project PROJECT --input operations.json --base-hash CURRENT_HASH --base-revision CURRENT_REVISION --json
showai pages save PAGE --project PROJECT --input revised.showai.json --base-hash CURRENT_HASH --base-revision CURRENT_REVISION --json
```

先完整读取，保留稳定节点 ID，再修改。pages diff --since 仅支持仍保留的读取/草稿基线；缺失时返回 MISSING_BASELINE，不提供旧页面历史浏览或版本恢复。冲突时比较双方内容；不要给旧全文替换请求换一个新 hash 强行提交。JSON 输入路径 `-` 表示标准输入。页面写入锁定自定义组件的精确版本与指纹。

新资源使用 v3 Page；`--kind board` 创建 Board。内容树、`layout` 外框和 `surfaceViews` 各司其职。`component.insert` 支持普通组件和原生 Page/Board；`surface.create`、`surface.wrap`、区块及视图操作保留身份。项目文件夹的 parentId 与内容容器 parentId 不同。参见 [Page 与 Board](page-surface.zh-CN.md)。

## 查询目录与参数

```sh
showai catalog list --kind component --project PROJECT --json
showai catalog describe chart --kind component --project PROJECT --view guide --json
showai catalog describe chart --kind component --project PROJECT --view schema --json
showai catalog describe chart --kind component --project PROJECT --view examples --json
showai catalog describe COMPONENT --project PROJECT --view parameters --parameter-path PATH --parameter-offset 0 --parameter-limit 20 --json
```

默认组件发现返回内置项与当前项目组件。明确查询 global/published/all 作用域可包含共享项。模板保留全部作用域的默认行为。省略 query、limit、cursor 可取得完整可访问目录；明确 limit（1–50）启用分页，并按返回的游标继续。目录变化后重新开始。每个组件条目还带一行由 props schema 生成的 `signature`：data 的字段与类型，必填在前；超过 320 个字符时嵌套结构折叠为 `{…}`、末尾字段折叠为 `…`。用它判断适配和准备数据；字段含义、省略行为和关系规则仍在 guide 与 parameters 视图。

| view                  | 返回内容                                         |
| --------------------- | ------------------------------------------------ |
| `summary`             | 身份、作用域、signature、用途与场景              |
| `guide`               | 使用约定、节点形状或模板说明                     |
| `parameters`          | 精确组件版本的参数含义、约束、省略行为与真实示例 |
| `schema` / `examples` | 数据结构 / 示例及默认初始化数据                  |
| `development`         | 实现指南，不含源码                               |
| `dependencies`        | 精确依赖与版本来源                               |
| `source`              | 显式源码与文件目录                               |
| `full`                | 说明、结构、示例与依赖；不含源码和可执行运行代码 |

保留返回的 scope/version/integrity，避免同名对象歧义。源码 view 可通过 `--file index.tsx` 读取一个文件；`--file '*' --out component-source.json` 输出完整原始包。只有编译代码的导入需要补回原始源码后才能编辑。参数协议详见 [组件参数](component-parameters.zh-CN.md)。

## 组件版本、组合与发布

```sh
showai catalog import --project PROJECT --input ./component-package --json
showai catalog save --project PROJECT --input component-source.json --json
showai catalog fork --project PROJECT --input ref.json --id my-variant --version 1.0.0 --json
showai catalog promote --project PROJECT --input ref.json --to global --json
showai catalog merge preview --project PROJECT --input merge-input.json --out merge-preview.json --json
showai catalog merge resolve --project PROJECT --input resolved-merge.json --json
```

源码输入包含 manifest、schema、source，可选 files/assets。相同 ID/version 的内容不可覆盖，修改要提升版本。ref 文件保留 kind/id/version/integrity 与作用域。promote 明确写入全局目录，不上传网络。合并提供 base/ours/theirs，检查预览后以新版本保存完整 resolved。参见 [组件与模板](catalog-lifecycle.zh-CN.md)。

父组件从 `showai:components` 导入内置组件；自定义子组件先在 `manifest.dependencies` 声明精确引用，再从 `showai:component/ID` 导入。传递 readOnly 并把子组件 onChange 接回父数据。编译后的父组件携带依赖，可离线运行；不能使用任意 npm 导入。

宿主提供 `onContext` 时，读者可以把组件当前的探索状态交给对话；快照、上限与宿主行为见 [页面格式](artifact-format.zh-CN.md)。

## 模板

新模板使用文件夹、严格 README 元信息、四阶段指南（intent、material、logic、design）和可选组件库：

```sh
showai template import ./my-template --project PROJECT --json
showai template export my-template --project PROJECT --out ./new-folder --json
showai template context --project PROJECT --templates my-template@1.0.0 --json
showai template guide design --project PROJECT --templates my-template --json
showai template apply TEMPLATE_ID --project PROJECT --version VERSION --title "我的报告" --json
```

旧的 `template save --page PAGE` 与 document/composition 定义继续可用。组合部分可以是内容或固定子模板引用；应用生成独立身份。插入已有页面需要 `--page`、`--base-hash`、`--base-revision`，可指定 `--parent`。详见 [模板文件夹](template-bundles.zh-CN.md)。

## 导出与发布准备

```sh
showai export --project PROJECT --page PAGE --format html --components bundled --out ./report.html --json
showai export --project PROJECT --page PAGE --format inline --components bundled --out ./report-inline.html --json
showai export --project PROJECT --page PAGE --blocks BLOCK_ID --format inline --out ./selection.html --json
showai export --project PROJECT --format site --components bundled --out ./site --json
showai publish prepare --project PROJECT --input publication-refs.json --out ./publication --json
showai publish verify --project PROJECT --url MANIFEST_URL --json
showai publish list --limit 20 --json
```

整页默认 spatial；`--presentation reading` 按阅读顺序呈现 Board。`--blocks` 指页面节点实例及后代，局部导出的 HTML 与伴随源 JSON 都是局部内容，不能拿来覆盖整页；整站拒绝局部选择。`page_present` 则始终提供完整 HTML/source，blockIds 只控制聊天预览。在由模型自己写 HTML 的宿主（`SHOWAI_HOST_DISPLAY=model-html`，例如 Claude Code）中，`page_present` 与 `render_document` 另外返回 `conversation`：`mode: "compact"` 带 `fragment`，原样交给宿主的 HTML 工具；`too-large` 表示整页超限，应带一到三个关键块的 `blockIds` 再调用；`unavailable` 表示运行时没有 CDN 阅读器。

内嵌组件与图片支持离线阅读。inline 最终 UTF-8 上限为 1,000,000 字节，会先无损压缩；超限时选择能独立理解的节点并保留完整页面。旧输出需要 `--overwrite`。导出禁止覆盖项目源与共享目录；项目的 exports 子目录可以使用。

远程组件模式需要已验证的精确网址和网络。prepare 只生成文件；上传由选定托管流程执行。verify 实际获取并校验清单、字节与指纹后登记发布；register 是同等校验的别名。它们不自动发布网站。

## 服务连接与维护

```sh
npm run plugin:install -- --json
npm run plugin:update -- --json
showai mcp --home /absolute/library
showai mcp --project PROJECT
showai mcp --public
```

插件已有本机 launcher；手工添加 MCP 时避免重复连接。安装、宿主刷新与会话加载分别检查。Claude Code 安装见 [插件说明](../../plugins/showai/README.zh-CN.md)。HTTP MCP、OAuth 与同步见 [Agent 接入](agent-integration.zh-CN.md)。

### 桌面版没有退出时

窗口无法安全关闭时，应用保持打开：页面或共享数据的修改既不能保存也不能保留为本机草稿、Agent 消息框的草稿无法存储、窗口中的某部分 15 秒内没有完成、窗口 20 秒内没有回应，或用户选择了继续编辑。应用会恢复该窗口并置于最前，在对话框中写明原因，并记录到 `showai-main.log`。同时在同一日志文件夹写入 `quit-blocked.json`（macOS：`~/Library/Logs/ShowAI/`；以 `SHOWAI_USER_DATA` 启动的实例：其 `logs/` 文件夹）。

该文件只在有窗口保持打开时存在，之后退出成功即删除；其中 `pid` 已不在运行时忽略。文件写明应用（`pid`、`appVersion`、`sourceCommit`、`home`、`log`），并列出每个保持打开的窗口：`title`、`trigger`（`quit` 或 `close`）、`state`（对话框打开时为 `awaiting-decision`，选择继续编辑后为 `kept-open`）和 `blockers`。每项原因包含稳定的 `code`（`PAGE_NOT_RETAINED`、`DATASET_NOT_RETAINED`、`ASSISTANT_DRAFT_NOT_SAVED`、`LISTENER_TIMEOUT`、`LISTENER_FAILED`、`LISTENER_REFUSED` 或 `NO_REPLY`）、所在部分 `source`、已知的页面或共享数据 ID 与标题，以及 `message`。窗口中也会为受影响的页面显示提示，可从提示打开页面。请在该窗口中处理原因，不要用其他方式退出或结束应用来绕过。

旧内容库可通过经过检查的 library import/activate 或 migrate 迁移，原始记录保留。`workspace merge` 比较活动草稿与当前内容；`workspace conflicts` 查询外部冲突；`workspace recover-package CONFLICT_ID --project PROJECT` 将外部包修改恢复为可编辑草稿，修复后保存新版本。

`library stats/compact/cleanup-plan/cleanup/rebuild-index/archive/verify-archive/policy` 提供容量统计、维护与核验。清理保留当前内容、原始档案和恢复材料。详见 [内容库](versioned-library.zh-CN.md)。

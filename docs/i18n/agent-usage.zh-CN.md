# CLI 脚本与运维参考

**语言：** [English](../agent-usage.md) | 简体中文 · [文档目录](index.zh-CN.md)

Agent 的文档操作使用 MCP，见 [Agent 接入](agent-integration.zh-CN.md)。本页面向脚本、服务配置、诊断与运维。CLI 每条命令完成后退出，可在桌面窗口关闭时运行；它与工作台使用同一内容库和保存保护。

## 当前 CLI 命令与 MCP 工具索引

CLI 索引列出已登记的命令、子命令和别名。MCP 索引按默认连接的 `tools/list` 分组。HTTP 列出的工具可能需要 OAuth 和项目权限才能执行。支持原页卡片的宿主还可以提供 `card_present` 等适配工具。

<!-- showai:runtime-index:start -->
<details>
<summary>按命令查看 CLI 注册表</summary>

```text
boards read

catalog describe
catalog fork
catalog import
catalog list
catalog merge
catalog promote
catalog remove
catalog save

datasets apply
datasets create
datasets delete
datasets link
datasets list
datasets read
datasets transform

export

guide

import

importers list
importers remove
importers save

library activate
library archive
library cleanup
library cleanup-plan
library compact
library import
library imports
library init
library migrate
library policy
library rebuild-index
library stats
library verify
library verify-archive

mcp
mcp serve

pages apply
pages create
pages delete
pages deleted
pages diff
pages duplicate
pages list
pages pin
pages read
pages restore
pages save
pages unpin

projects bind
projects create
projects current
projects list

public describe
public list

publish list
publish prepare
publish register
publish verify

render

runtime info
runtime register

search

serve

sync account
sync attach
sync conflict
sync connect
sync dashboard
sync default
sync detach
sync disconnect
sync join
sync projects
sync resolve
sync retained
sync run
sync status
sync subscribe

template apply
template context
template export
template import
template instantiate
template save

workspace conflict
workspace conflicts
workspace merge
workspace recover-package
workspace resolve
```

</details>

<details>
<summary>按连接模式查看 MCP 工具</summary>

```text
本机内容库 · stdio (47)
board_read  catalog_describe  catalog_list  catalog_merge_preview
catalog_references  catalog_version  component_save  dataset_delete
dataset_read  dataset_write  draft_read  draft_remove  draft_write
library_search  organization_read  organization_update  page_apply
page_create  page_diff  page_export  page_merge_preview  page_merge_save
page_present  page_read  page_save  pages_list  project_context
project_create  project_resolve  project_sync  project_sync_status
projects_list  public_catalog_describe  public_catalog_list  publication_list
publication_prepare  render_document  show_component  show_component_close
show_component_read  show_component_update  showai_capabilities
template_apply  template_context  template_save  workspace_conflict
workspace_resolve

固定项目 · stdio (44)
board_read  catalog_describe  catalog_list  catalog_merge_preview
catalog_references  catalog_version  component_save  dataset_delete
dataset_read  dataset_write  draft_read  draft_remove  draft_write
library_search  organization_read  organization_update  page_apply
page_create  page_diff  page_export  page_merge_preview  page_merge_save
page_present  page_read  page_save  pages_list  project_context  project_sync
project_sync_status  public_catalog_describe  public_catalog_list
publication_list  publication_prepare  render_document  show_component
show_component_close  show_component_read  show_component_update
showai_capabilities  template_apply  template_context  template_save
workspace_conflict  workspace_resolve

公开资源 · stdio (8)
public_catalog_describe  public_catalog_list  render_document  show_component
show_component_close  show_component_read  show_component_update
showai_capabilities

托管 HTTP · 工具发现 (39)
board_read  catalog_describe  catalog_list  catalog_merge_preview
catalog_references  catalog_version  component_save  dataset_delete
dataset_read  dataset_write  draft_read  draft_remove  draft_write
library_search  organization_read  organization_update  page_apply
page_create  page_diff  page_export  page_merge_preview  page_merge_save
page_present  page_read  page_save  pages_list  presentation_source
project_context  project_create  projects_list  public_catalog_describe
public_catalog_list  publication_list  render_document  show_component
showai_capabilities  template_apply  template_context  template_save
```

</details>
<!-- showai:runtime-index:end -->

## 使用正确的运行时

T3 Code 支持 MCP App 的提供方可以在对话里直接显示交互组件。其他提供方用 `t3-html` 获取完整 HTML，再交给 `html_preview` 和 `html_render`。需要编辑时用 `workbench_page_url` 返回的执行环境目标打开原页。[提供方接入与展示](agent-integration.zh-CN.md#t3-code)

下面的 `showai` 代表经过核实的命令前缀，例如 `node /absolute/path/ShowAI/dist-runtime/scripts/cli.mjs`，不假设已安装全局 npm 命令。本机独立运行需要 Node.js 22.12+；桌面 App 的「设置 → MCP → 本机启动配置」提供内置可执行文件、CLI 路径和环境变量。

本机插件通过所选内容库的 `agent-runtime.json` 发现软件，并调用 `runtime info --json` 核对能力。桌面启动会登记运行时；独立包可运行 `runtime register --json`。`--home /absolute/library` 或 `SHOWAI_HOME` 指定内容库，默认 `~/.showai`。

```sh
showai runtime info --json
showai guide --json
showai guide authoring --json
showai guide catalog --json
```

指南还包含 `workspace`、`containers`、`whiteboard`、`document`、`templates`、`versions`、`export` 和 `publish`。以当前运行时返回的操作形状和限制为准。JSON 成功返回 `{ "ok": true, "data": ... }`；失败返回 `ok:false`、错误码与原因并以非零状态退出，页面冲突退出码为 3。

只有 `import` 和 `datasets transform` 支持 `--dry-run`。CLI 会在打开内容库之前拒绝未知选项和当前命令不支持的选项。使用 `--json` 时，这些错误也按上述 JSON 格式返回。

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

`pages read PAGE --references to|from|both`（MCP 的 `page_read` 加 `references`）在读取结果中加上页面之间的引用：`to` 列出引用这一页的页面（反向链接），`from` 列出这一页引用的页面，每一项带有引用所在的块、指向的块和周围的文字。正文里的页面链接（包括组件里的文字和步骤）、数据库的页面列，以及组件用 `page` 参数规则声明的字段都计入。Markdown 中提到另一页写页面链接 `[标题](showai://project/PROJECT/page/PAGE)`，放进一行文字的组件写 `@[kind]{data}`，例如 `@[date]{"date":"2026-11-20"}`。

新资源使用 v3 Page；`--kind board` 创建 Board。内容树、`layout` 外框和 `surfaceViews` 各司其职。`component.insert` 支持普通组件和原生 Page/Board；插入 stepper 时，`steps[].blocks` 中的 `{kind, data}` 组件会在同一次插入中放到对应步骤的文字之后；`surface.create`、`surface.wrap`、区块及视图操作保留身份。项目文件夹的 parentId 与内容容器 parentId 不同。参见 [Page 与 Board](page-surface.zh-CN.md)。

## 查询目录与参数

在聊天里做可视化时，用 show-visual 编写原创 HTML，直接调用 `show_component({html})`。多幅图按顺序传入数组，每次最多五幅。用户明确要求使用现有 ShowAI 组件时才查询目录，已知 ID 可直接读使用说明。需要核对宿主显示方式时用 `showai_capabilities({view:"presentation"})`。

用户要求注册复用时，从回执的 source 读回选中片段，让 HTML 从 `window.showaiData` 读取业务参数。用原数据和另一组有效数据验证同一份 HTML 的画面和交互。以 `visual.html` 为入口注册已验证的源码，原始数据放入 defaultData，替代数据放入 manifest.examples。预览与注册后的 HTML 使用相同的沙箱。

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

新模板使用文件夹、严格 README 元信息、按阅读顺序列出的指南和可选组件库；`template context` 一次返回所选模板的 README 与全部指南：

```sh
showai template import ./my-template --project PROJECT --json
showai template export my-template --project PROJECT --out ./new-folder --json
showai template context --project PROJECT --templates my-template@1.0.0 --json
showai template apply TEMPLATE_ID --project PROJECT --version VERSION --title "我的报告" --json
```

旧的 `template save --page PAGE` 与 document/composition 定义继续可用。组合部分可以是内容或固定子模板引用；应用生成独立身份。插入已有页面需要 `--page`、`--base-hash`、`--base-revision`，可指定 `--parent`。详见 [模板文件夹](template-bundles.zh-CN.md)。

## 导出与发布准备

临时可视化使用 `show_component`。当前连接提供 `card_present` 时，本轮新建或续改成功的页面用一组可点击的原页卡片交付。按宿主适配处理侧栏编辑器或编辑链接。用户明确要求在对话中阅读正文或片段时，使用 `page_present`。没有卡片工具时，给出所在项目，并使用可用的阅读视图、文件或原页链接交付。

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

在工作台选择「导出网站 → 联网网站」时，版本号和指纹都匹配的组件会引用已验证的发布地址，其余组件随使用它们的页面打包。通过 CLI 或 MCP 显式选择远程组件时，每个组件都需要已验证的发布版本。

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

## 测量真实布局

使用 `page_read` 的 `view:"image"`、`capture:"viewport"`、`viewport:{width:1440,height:900}` 捕获固定窗口。省略 capture 保留原来的 full 行为，长内容可能使浏览器扩高；返回的 capture 记录请求视口、实际捕获视口与 expanded。

添加 `inspect:{layout:true,blockIds:["图ID","解释ID"]}`，测量对象在原页面中的布局。它不同于顶层 blockIds，不会抽取区块。`scrollToBlockId:"图ID"` 滚动到已渲染的块，不展开隐藏步骤。layout.blocks 返回相对视口的 CSS 像素边界、经视口和祖先裁切后的可见边界与面积比例、块高/视口高，以及 client/scroll 尺寸与 overflow 模式。测量发生在全文截图扩高之前。未挂载块为 not-rendered；默认最多 200 个对象并带 total/truncated，显式目标最多 100 个 ID。它不评判美观，也不覆盖兄弟元素遮挡、位图文字和 iframe 内部。

CLI：`showai pages read PAGE --project PROJECT --view image --capture viewport --width 1440 --height 900 --scroll-to-block BLOCK --state inspect.json --json`，其中 inspect.json 为 `{"inspect":{"layout":true,"blockIds":["BLOCK"]}}`。image 与 html 均支持测量；使用 out 时 MCP 回执仍保留 capture/layout，完整 `.read.json` 从 metadataPath 取得。调整前后用相同视口与定位比较，保存仍遵循 hash/revision 冲突检查。

## 可选的对话持续更新

支持插件界面的 Codex 桌面端可以从主侧栏打开 ShowAI 项目工作台，也可以在聊天右侧打开同一个 Page 和 Board 编辑器。选中内容后用「引用到 Codex 对话」交给当前聊天。Codex 按引用用 ShowAI MCP 读取对应对象，写入原页面之前核对版本。

Codex 插件声明 `SHOWAI_HOST_DISPLAY=mcp-app`。`show_component` 的 `delivery:"auto"` 使用原生视图；用户指定的目录组件分批接收数据时加 `live:true`，先展示第一批有效内容，再更新同一显示区。小任务一次给完，正式页面创作流程保持不变。旧安装若仍声明 `codex-visualize`，可在支持 MCP Apps 的 Codex 中显式使用 `delivery:"mcp-app"`；旧声明仍保留文件式交付含义。

页面创作使用 page_create、page_apply、page_save，保存后的交付入口由当前宿主适配决定。会话可用 `show_component({kind,data,live:true,delivery:"mcp-app"})` 创建一个可持续更新的 MCP Apps 显示区。先查 `showai_capabilities.presentation.liveUpdates`，并确认宿主提供 serverTools；文件片段展示不代表支持持续更新。当前句柄属于原本机 MCP 连接，30 分钟未访问后过期，重连后不恢复；最多 32 份，每份源内容最多 16 MiB。

保留回执 live.viewId、live.revision 和 blocks[].id。后续 `show_component_update({viewId,operationId,baseRevision,operations,complete?})` 沿用 page_apply 的稳定节点操作。每批应形成合法组件数据，相关字段一起更新；无效批次保留旧内容与版本。最近一次完全相同的请求可重试；CONFLICT 时先读回当前内容并比较，不盲目替换基线。最后带 complete:true，可用空 operations 结束，完成后只读。

`show_component_read({viewId,source:true})` 返回最新完整 artifact，按正常项目流程保存 document 和 components；若返回 componentSources，先用 component_save 保存这些包，再引用回执的精确版本，以保留可编辑源码。阅读探索状态单独处理。`show_component_close({viewId})` 只释放临时显示区。阅读器自行读取新版本并更新已挂载组件，不启动模型回合。一次性调用、正式页面和导出格式保持兼容；HTTP、图片、compact 和 fragment-file 沿用完整结果交付。


## 组件能力与组合

绑定内部对象前，先读 showai_capabilities.componentRuntime，再以 catalog_describe view:"contract" 查询精确组件版本。返回的是编译器与阅读器共用的契约；没有声明的包标为 legacy，不根据可点击画面推断事件能力。传 instance:{pageId,blockId} 枚举页面实际对象，objectOffset/objectLimit 分页，共享数据也会先解析。

CLI 使用 showai catalog describe ID --view contract --project PROJECT --page PAGE --block BLOCK --json。没有 instance 时对象来自 defaultData，不代表当前页面。新组件提供 contract version 1；声明对象、事件、子内容与动作前，读取已安装的 create-component Skill 及其组件制作格式中的 runtimeContractSchema。数据仍通过已有 Page 操作编辑，保持业务 ID 稳定；内容块引用沿声明更新。组件版本保持不可变；升级事件契约时，必要的父级绑定修改应放在同一页面变更中。旧组件和页面保留原编译包，通过兼容入口运行。

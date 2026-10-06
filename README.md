# ShowAI

把调研、解释和数据组织成可交互、可分享的网页。

ShowAI 提供桌面工作台、React 组件与模板，以及供 Codex、Claude Code 和其他 Agent 使用的本地命令。人和 Agent 编辑同一份项目文件，完成的页面可以导出为单个 HTML、会话内展示片段或多页静态网站。

工作台管理项目、页面、模板和组件；交付页面只呈现内容与必要交互。文字、图片、图表、对比表和参数控件可以组合在同一页中。

## 桌面使用

构建后的安装包位于 `release/`。macOS arm64 使用 `ShowAI-0.5.0-arm64.dmg`：打开后将 ShowAI 拖入「应用程序」，再启动应用。当前构建采用临时签名，尚未进行 Apple 公证；请通过系统提供的「仍要打开」流程打开你信任的本地构建。

Windows x64 的 NSIS 安装配置已包含在仓库中，应在 Windows 构建并验收后分发。当前仓库没有公开发布的安装包或 npm/PyPI 安装入口。

打开应用后，新建项目，在项目中创建页面或选择模板。页面会自动保存到本地内容库。模板可以预览、编辑和保存；组件库可以查看说明、预设和代码，也可以导入本地 React 组件包。

每个 Page 默认是一块白板。文字、图片、组件和区域共享同一空间；区域支持纵向排布、网格和自由布局，可并排组织、嵌套或整体移动。左右滑动保留可见的弹性阻力，完整显示的区域轻微吸附。用「总览」「定位所选」和命名视图浏览内容，阅读顺序用于网页与打印输出。详见 [Page 白板](docs/page-surface.md)。

项目、文件夹和页面的操作集中在悬停或键盘聚焦时出现的省略号菜单中，可新建页面或嵌套文件夹、重命名、删除和置顶。置顶项排在同级列表前面；删除文件夹时，其下内容会一并退出列表和整站导出，源文件仍保留在内容库中。

默认内容库为 `~/.showai`，可在「设置 → 内容位置」中更改。项目文件、页面与变更快照保存在磁盘中；CLI 和桌面应用使用同一目录时，可以互相看到修改。

## 本地浏览器版

macOS 可以选择桌面 App 或本地浏览器版；Linux 和 Windows 可以使用本地浏览器版。两种入口共用工作台、项目格式、组件编译器和 Agent CLI，指向同一内容库时直接读写同一份磁盘文件。

浏览器发行包包含独立 Node 运行时，无需另装 Node 或 Electron。解压对应系统与架构的包后，macOS 双击 `start.command`，Linux 运行 `./start.sh`，Windows 双击 `start.cmd`。启动器打开本机工作台地址；使用期间保留终端窗口，按 Ctrl+C 停止服务。详见 [本地浏览器版使用说明](docs/local-browser.md)。

本地浏览器工作台提供项目、文件夹、页面、模板、组件源码编辑、版本管理和导出。文件对话框直接浏览本机目录，导出结果写入所选磁盘位置。CLI 修改后工作台自动刷新，文件版本冲突沿用桌面版的检查与处理方式。

从源码构建并运行：

```sh
npm ci
npm run build:browser
npm run browser
```

指定内容库与端口，或在没有图形桌面的环境下手动打开地址：

```sh
node dist-runtime/scripts/cli.mjs serve --home /absolute/path/to/library --port 5175 --no-open
```

默认内容库为 `~/.showai`。没有指定 `--home` 或 `SHOWAI_HOME` 时，可在设置中切换内容位置；浏览器版会独立记住这个位置。指定同一个目录即可与 Mac App 并行使用。

发行包提供 `showai`（macOS/Linux）和 `showai.cmd`（Windows）。Agent CLI 无需启动工作台服务：

```sh
./showai projects list --json
./showai runtime register --json
```

运行工作台或登记运行时后，在「设置 → Agent」复制启动配置；它包含发行包自带 Node、CLI 和当前内容库路径。已有 Codex/Claude Code 技能和可选 stdio MCP 继续使用同一套命令。

在目标系统上执行 `npm run package:browser`，会生成 `release/ShowAI-browser-版本-系统-架构/` 与压缩包。打包程序下载官方独立 Node 并校验摘要；构建依赖仍需要开发环境 Node.js 22.12+。GitHub 的「Browser distributions」工作流可手动构建和验证 Linux、Windows、macOS 包。

## 从源码运行

需要 Node.js 22.12+ 和 npm。仓库访问权限由 GitHub 管理。

```sh
git clone git@github.com:Renaissance-Mind/ShowAI.git
cd ShowAI
npm ci
npm run build
npm run desktop
```

桌面应用读取构建后的前端。修改代码后重新执行 `npm run build` 再启动。`npm run dev` 提供单页画布开发预览；完整本地工作台通过 `npm run desktop` 或 `npm run browser` 启动。

构建安装包：

```sh
# 在 macOS arm64 构建
npm run package:mac

# 在 Windows x64 构建
npm run package:win
```

组件编译器包含平台二进制，请在目标系统上安装依赖并构建插件与应用。上述命令只生成本地产物。

## 通过 Agent 创作

ShowAI CLI 直接读写项目文件，每次命令执行完成后退出。使用 CLI 时无需启动桌面应用，也无需先运行 Core 服务。

```sh
node dist-runtime/scripts/cli.mjs projects create --name "模型调研" --json
node dist-runtime/scripts/cli.mjs catalog list --kind template --json
node dist-runtime/scripts/cli.mjs template apply research --project PROJECT_ID --title "调研结果" --json
node dist-runtime/scripts/cli.mjs pages list --project PROJECT_ID --json
```

把 `PROJECT_ID` 替换为新建项目返回的 id。每条页面命令显式指定项目。需要绑定会话时，创建项目时加上 `--harness codex --session ACTUAL_SESSION_ID`；只有用户选择复用已有项目时才绑定到该项目。

编辑前读取页面并保留返回的 `hash`。后续使用 `pages diff --since HASH` 查看用户修改，写入时通过 `--base-hash HASH` 防止覆盖更新。完整命令、操作格式和 Python 调用示例见 [Agent 使用说明](docs/agent-usage.md)。

桌面安装包内也带有 CLI 和运行时。打开「设置 → 连接 Agent」，复制启动配置即可取得可执行文件、参数和内容库路径；使用这份配置的 Agent 不需要另装 Node.js。

## 单页与网站交付

```sh
node dist-runtime/scripts/cli.mjs export --project PROJECT_ID --page PAGE_ID --format html --out ./report.html --json
node dist-runtime/scripts/cli.mjs export --project PROJECT_ID --page PAGE_ID --format inline --out ./report-inline.html --json
node dist-runtime/scripts/cli.mjs export --project PROJECT_ID --page PAGE_ID --blocks PROGRESS_BLOCK_ID --format inline --out ./progress-inline.html --overwrite --json
node dist-runtime/scripts/cli.mjs export --project PROJECT_ID --format site --out ./site --json
```

| 产物         | 用途                                | 打开方式                                   |
| ------------ | ----------------------------------- | ------------------------------------------ |
| 单 HTML      | 发给他人、归档、离线阅读            | 用浏览器直接打开                           |
| inline 片段  | 在支持 HTML 展示的 Agent 会话中呈现 | 交给宿主的展示通道                         |
| 静态网站目录 | 多页面导航与网址分享                | 上传静态托管服务，或通过本地 HTTP 服务预览 |

独立 HTML 包含阅读器、内容、数据和所用自定义组件，读者不需要安装 ShowAI。图表切换、数据筛选、折叠内容和本地参数计算可离线使用；外部来源链接需要联网。离线导出要求图片已内嵌，CLI 会拒绝仍依赖外链图片的页面。

增加 `--presentation reading` 可导出按阅读顺序排列的响应式网页；默认 `spatial` 保留白板浏览。两种呈现保存相同的完整空间源文件。

HTML 与 inline 导出同时保存 `.showai.json` 源文件；独立页面的菜单也可下载源文件。桌面工作台可以导入 ShowAI HTML 或 JSON，继续编辑。自定义组件的运行代码随交付物保存，重新导入后仍可呈现；要修改该组件的 React 源代码，需要其原始组件包。

加上 `--blocks ID,ID` 可以只可视化一个或多个页面组件，也可以选中整个区域。ID 来自 `pages read` 返回节点的 `attrs.id`，表示页面中的组件实例。局部导出保留必要父容器、页面顺序和所需组件运行代码，默认使用 reading 布局并隐藏页面总标题；需要保留白板位置时显式使用 `--presentation spatial`。局部 HTML 和 inline 及其源 JSON 只包含选中部分，原页面保持完整。修改结果或自动化进度更新可以只在 Agent 聊天里展示对应组件；后续编辑仍读取完整页面并使用当前 hash。`--blocks` 适用于 html 和 inline，整站导出不接受该参数。

整站导出只包含项目中未归档的页面，使用相对导航和共享阅读器资源。导出不会自动上传到网络。首次写入不会覆盖已有文件；需要更新已有交付物时显式使用 `--overwrite`。

## Codex 与 Claude Code 插件

插件只分发三个技能：`show-document` 创建和修改页面，`create-component` 定义可复用组件，`extract-template` 将成熟页面抽象为模板。CLI、阅读器和组件编译器由独立安装的 ShowAI 软件提供；本地构建的运行包位于 `dist-runtime/`，桌面安装包把它放入 `Resources/runtime/`。

桌面启动后会在所选内容目录登记 `agent-runtime.json`。使用独立运行包时执行 `npm run runtime:register`；技能读取启动配置并通过 `runtime info` 验证版本与内容目录。

Codex：在仓库中运行安装命令，之后每次修改代码再运行更新命令：

```sh
npm run plugin:install
npm run plugin:update
```

两条命令只检查技能包，通过官方 `codex plugin marketplace add` / `codex plugin add` 安装或刷新当前本地来源，并逐文件比对安装副本与构建结果，确认插件已启用。无需重建桌面安装包，也不会自动拉取 Git、修改其他插件来源或重启 Codex。需要 Node.js 22.12+ 和支持 `codex plugin add` 的 Codex CLI。

更新结果保存在 `artifacts/codex-plugin-install.json`，包含实际安装路径和文件哈希。完成后新开 Codex 会话加载技能；本地更新可以保持同一开发版本号，是否成功以安装副本校验为准。如果同名 marketplace 指向其他目录，或缓存校验失败，命令会明确报错，保留现有插件供检查。详见 [插件说明](plugins/showai/README.md)。

Claude Code：在 ShowAI 仓库中执行：

```sh
claude plugin marketplace add ./
claude plugin install showai@renaissance-mind
```

开发时也可以用 `claude --plugin-dir ./plugins/showai` 加载技能。插件自身不携带运行程序；先安装 ShowAI 或构建并登记外部运行包。外部 Node 方式需要 Node.js 22.12+；桌面配置使用应用自带运行时。

MCP 是可选的工具入口，通过 `mcp --project PROJECT_ID` 启动并固定到一个项目。具体配置见 [Agent 使用说明](docs/agent-usage.md#optional-mcp)。插件不会设置跨会话共享的全局活动项目。

会话内 HTML 展示取决于宿主能力。Codex 的 visualize 展示通道可以接收 inline 片段；普通终端或仅支持 MCP 工具的客户端返回 HTML 文件或预览地址。安装 MCP 工具本身不会增加网页渲染能力。

## 组件与模板

流程图控件基于 [React Flow](https://reactflow.dev/) 与 Dagre，支持多条流程、节点详情、缩放和节点编辑。通过目录查询 `flowchart` 的 schema 与示例；自定义组件可从 `showai:components` 导入 `Flowchart`。技能的触发条件与披露顺序见 [技能组织](docs/skills.md)。

组件和模板按「项目 → 全局 → 已发布」查找，内置预设作为兜底。定制默认属于选定项目；注册全局、登记发布都需要显式操作。版本使用 `id + version + integrity` 标识，已有页面锁定实际引用，不会随其他项目的修改或新版本发布而变化。

组件说明包含分点的使用场景、可视化效果和示例。模板说明包含使用场景、内容处理方式、相关模板/组件 ID，以及描述需求、使用顺序与结构的示例。Agent 先查询摘要，再按需请求说明、参数或源码：

```sh
node dist-runtime/scripts/cli.mjs guide catalog --json
node dist-runtime/scripts/cli.mjs catalog list --kind component --query 面积 --project PROJECT_ID --limit 5 --json
node dist-runtime/scripts/cli.mjs catalog describe playground --view examples --project PROJECT_ID --json
```

项目里的组件可以注册为不可变的全局版本，其他项目再从它派生自己的版本。`parents` 保留来源关系，三方合并会显示冲突，并把解决结果保存为新的项目版本；全局、已发布和父版本均不会被覆盖。

模板支持有序组合与递归引用其他模板，并锁定子模板和实际组件依赖。应用模板时展开成独立页面，生成新的页面与区块 ID。分享成品只需要展开后的页面及用到的组件；无需携带模板定义。注册组合模板时会收集完整依赖，即使来源项目被移除，其他项目仍可使用注册版本。产品未额外预置组合模板。

画布中的基础内容也进入组件目录：文本、图像、基础表格、提示框、折叠内容、分隔线与代码块，均可由 Agent 查询说明、数据结构与示例，并从起始源码定制项目版本。组件与模板的概览把说明和实时示例放在同一页，按窗口宽度采用左右或上下布局。

组件可在代码中嵌套：从 `showai:components` 导入内置 React 实现；在 `manifest.dependencies` 中声明子组件的固定版本与指纹，再从 `showai:component/<id>` 导入。编译后的父组件包含子组件运行代码，注册与发布同时保存完整依赖源码。用法见 [Agent 组件组合](docs/agent-usage.md#basic-components-and-code-composition)。

自定义组件包包含 `manifest.json`、`props.schema.json` 和 React 入口代码。参考 [数值滑块组件](resources/catalog/value-slider)：

```sh
node dist-runtime/scripts/cli.mjs catalog import --input ./resources/catalog/value-slider --project PROJECT_ID --json
```

桌面与独立 HTML 中，组件在隔离 iframe 中运行，不能访问应用文件系统或直接连接外部网络。会话 inline 模式使用宿主提供的整页沙箱与 Shadow DOM 样式隔离，组件之间共享该页面的 JavaScript 环境。

## 发布与远程引用

导出默认 `--components bundled`，把所需组件一起打包，保持离线能力。选择 `--components remote` 时，每个自定义组件都必须已有经过验证的固定发布地址；缺失依赖会明确列出并拒绝导出。阅读器下载时再次校验字节摘要与版本指纹，无法联网或校验失败时显示错误。会话 inline 交付始终打包组件。

发布流程是准备一个可自部署的静态目录，再验证已部署的清单网址并登记。准备文件不会自动上传，也不会直接变成「已发布」。同一套目录可放到用户自己的静态服务器；远程请求使用精确的内容地址，不会悄悄切换到最新版。

```sh
node dist-runtime/scripts/cli.mjs guide publish --json
node dist-runtime/scripts/cli.mjs guide versions --json
```

数据目录、解析规则、版本派生、依赖闭包和合并边界见 [目录生命周期](docs/catalog-lifecycle.md)，具体命令见 [Agent 使用说明](docs/agent-usage.md)。

## 开发与验证

```sh
npm run check
npm test
npm run build
npm audit
```

`npm run test:whiteboard` 检查真实本地浏览器白板，`npm run test:whiteboard:desktop` 在 Electron 中运行同一模型与交互验收。

`npm test` 会先构建独立阅读器，再验证真实导出。`npm run test:desktop` 在本机启动独立数据目录的 Electron，检查文件接口、编辑冲突、退出保存、目录版本和组合模板。CI 执行类型检查、测试、构建和依赖审计；安装包仍需在目标系统运行验收。

| 目录                           | 职责                                           |
| ------------------------------ | ---------------------------------------------- |
| `src/core`                     | 项目文件、快照、差异、冲突保护、组件与模板目录 |
| `src/studio`、`src/desktop`    | React 工作台与 Electron 本地文件接口           |
| `src/editor`、`src/components` | 内容编辑器、内置区块、自定义组件               |
| `src/portable`                 | 轻量只读页面与离线交付格式                     |
| `src/agent`                    | CLI、MCP 和导出                                |
| `plugins/showai`               | Codex/Claude 技能与按需参考资料                |
| `dist-runtime`                 | 外部 CLI、阅读器与编译依赖                     |

开发工具链将 `app-builder-lib` 使用的 `@electron/get` 固定到 `5.1.0`，以移除旧 HTTP 缓存依赖；Node.js 最低版本与该下载器保持一致。

许可证尚未指定。

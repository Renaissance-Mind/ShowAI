# ShowAI

把调研、解释和数据组织成可交互、可分享的网页。

ShowAI 提供桌面工作台、React 组件与模板，以及供 Codex、Claude Code 和其他 Agent 使用的本地命令。人和 Agent 编辑同一份项目文件，完成的页面可以导出为单个 HTML、会话内展示片段或多页静态网站。

工作台管理项目、页面、模板和组件；交付页面只呈现内容与必要交互。文字、图片、图表、对比表和参数控件可以组合在同一页中。

## 桌面使用

构建后的安装包位于 `release/`。macOS arm64 使用 `ShowAI-0.3.1-arm64.dmg`：打开后将 ShowAI 拖入「应用程序」，再启动应用。当前构建采用临时签名，尚未进行 Apple 公证；请通过系统提供的「仍要打开」流程打开你信任的本地构建。

Windows x64 的 NSIS 安装配置已包含在仓库中，应在 Windows 构建并验收后分发。当前仓库没有公开发布的安装包或 npm/PyPI 安装入口。

打开应用后，新建项目，在项目中创建页面或选择模板。页面会自动保存到本地内容库。模板可以预览、编辑和保存；组件库可以查看说明、预设和代码，也可以导入本地 React 组件包。

项目、文件夹和页面的操作集中在悬停或键盘聚焦时出现的省略号菜单中，可新建页面或嵌套文件夹、重命名、删除和置顶。置顶项排在同级列表前面；删除文件夹时，其下内容会一并退出列表和整站导出，源文件仍保留在内容库中。

默认内容库为 `~/.showai`，可在「设置 → 内容位置」中更改。项目文件、页面与变更快照保存在磁盘中；CLI 和桌面应用使用同一目录时，可以互相看到修改。

## 从源码运行

需要 Node.js 22.12+ 和 npm。仓库访问权限由 GitHub 管理。

```sh
git clone git@github.com:Renaissance-Mind/ShowAI.git
cd ShowAI
npm ci
npm run build
npm run desktop
```

桌面应用读取构建后的前端。修改代码后重新执行 `npm run build` 再启动。`npm run dev` 提供浏览器中的单页画布开发预览；完整项目管理和磁盘访问由桌面应用提供。

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
node dist-agent/cli.mjs projects create --name "模型调研" --json
node dist-agent/cli.mjs catalog list --kind template --json
node dist-agent/cli.mjs template apply research --project PROJECT_ID --title "调研结果" --json
node dist-agent/cli.mjs pages list --project PROJECT_ID --json
```

把 `PROJECT_ID` 替换为新建项目返回的 id。每条页面命令显式指定项目。需要绑定会话时，创建项目时加上 `--harness codex --session ACTUAL_SESSION_ID`；只有用户选择复用已有项目时才绑定到该项目。

编辑前读取页面并保留返回的 `hash`。后续使用 `pages diff --since HASH` 查看用户修改，写入时通过 `--base-hash HASH` 防止覆盖更新。完整命令、操作格式和 Python 调用示例见 [Agent 使用说明](docs/agent-usage.md)。

桌面安装包内也带有 CLI 和运行时。打开「设置 → 连接 Agent」，复制启动配置即可取得可执行文件、参数和内容库路径；使用这份配置的 Agent 不需要另装 Node.js。

## 单页与网站交付

```sh
node dist-agent/cli.mjs export --project PROJECT_ID --page PAGE_ID --format html --out ./report.html --json
node dist-agent/cli.mjs export --project PROJECT_ID --page PAGE_ID --format inline --out ./report-inline.html --json
node dist-agent/cli.mjs export --project PROJECT_ID --format site --out ./site --json
```

| 产物         | 用途                                | 打开方式                                   |
| ------------ | ----------------------------------- | ------------------------------------------ |
| 单 HTML      | 发给他人、归档、离线阅读            | 用浏览器直接打开                           |
| inline 片段  | 在支持 HTML 展示的 Agent 会话中呈现 | 交给宿主的展示通道                         |
| 静态网站目录 | 多页面导航与网址分享                | 上传静态托管服务，或通过本地 HTTP 服务预览 |

独立 HTML 包含阅读器、内容、数据和所用自定义组件，读者不需要安装 ShowAI。图表切换、数据筛选、折叠内容和本地参数计算可离线使用；外部来源链接需要联网。离线导出要求图片已内嵌，CLI 会拒绝仍依赖外链图片的页面。

HTML 与 inline 导出同时保存 `.showai.json` 源文件；独立页面的菜单也可下载源文件。桌面工作台可以导入 ShowAI HTML 或 JSON，继续编辑。自定义组件的运行代码随交付物保存，重新导入后仍可呈现；要修改该组件的 React 源代码，需要其原始组件包。

整站导出只包含项目中未归档的页面，使用相对导航和共享阅读器资源。导出不会自动上传到网络。首次写入不会覆盖已有文件；需要更新已有交付物时显式使用 `--overwrite`。

## Codex 与 Claude Code 插件

`npm run build` 生成 `plugins/showai/`，其中包含技能、CLI、阅读器、组件编译器和使用说明。插件使用与桌面工作台相同的项目文件。

Codex：在仓库中运行安装命令，之后每次修改代码再运行更新命令：

```sh
npm run plugin:install
npm run plugin:update
```

两条命令都会构建阅读器、CLI 和插件包，通过官方 `codex plugin marketplace add` / `codex plugin add` 安装或刷新当前本地来源，并逐文件比对安装副本与构建结果，确认插件已启用。无需重建桌面安装包，也不会自动拉取 Git、修改其他插件来源或重启 Codex。需要 Node.js 22.12+ 和支持 `codex plugin add` 的 Codex CLI。

更新结果保存在 `artifacts/codex-plugin-install.json`，包含实际安装路径和文件哈希。完成后新开 Codex 会话加载技能；本地更新可以保持同一开发版本号，是否成功以安装副本校验为准。如果同名 marketplace 指向其他目录，或缓存校验失败，命令会明确报错，保留现有插件供检查。详见 [插件说明](plugins/showai/README.md)。

Claude Code：在 ShowAI 仓库中执行：

```sh
claude plugin marketplace add ./
claude plugin install showai@renaissance-mind
```

开发时也可以用 `claude --plugin-dir ./plugins/showai`，为当前会话加载插件。单独安装插件需要 Node.js 22.12+；使用桌面应用复制出的启动配置时，可以使用应用自带运行时。

MCP 是可选的工具入口，通过 `mcp --project PROJECT_ID` 启动并固定到一个项目。具体配置见 [Agent 使用说明](docs/agent-usage.md#optional-mcp)。插件不会设置跨会话共享的全局活动项目。

会话内 HTML 展示取决于宿主能力。Codex 的 visualize 展示通道可以接收 inline 片段；普通终端或仅支持 MCP 工具的客户端返回 HTML 文件或预览地址。安装 MCP 工具本身不会增加网页渲染能力。

## 组件与模板

内置组件包括图表、数据库/看板、指标、参数计算、图片集和来源卡片，另有文字、列表、表格、图片、提示块和折叠块。组件目录提供用途、输入规则、场景和预设，便于 Agent 选择。

自定义组件包包含 `manifest.json`、`props.schema.json` 和 React 入口代码，可通过组件库或 CLI 导入：

```sh
node dist-agent/cli.mjs catalog import --input ./resources/catalog/value-slider --project PROJECT_ID --json
node dist-agent/cli.mjs catalog describe value-slider --project PROJECT_ID --json
```

参考 [数值滑块组件](resources/catalog/value-slider)。桌面与独立 HTML 中，组件在隔离 iframe 中运行，支持 React 与包内本地资源，不能访问应用文件系统或连接外部网络。会话 inline 模式使用宿主提供的整页沙箱与 Shadow DOM 样式隔离，组件之间共享该页面的 JavaScript 环境。已经安装的版本保持不变，代码修改需要提升版本号。

模板保存页面结构、组件配置和内容。应用模板会生成一份具有独立页面与区块 id 的新页面，后续修改互不影响。也可以把已有页面保存为项目模板。

## 开发与验证

```sh
npm run check
npm test
npm run build
npm audit
```

`npm test` 会先构建独立阅读器，再验证真实导出。`npm run test:desktop` 在本机启动独立数据目录的 Electron，检查文件接口、编辑冲突和退出保存。CI 执行类型检查、测试、构建和依赖审计；安装包仍需在目标系统运行验收。

| 目录                           | 职责                                           |
| ------------------------------ | ---------------------------------------------- |
| `src/core`                     | 项目文件、快照、差异、冲突保护、组件与模板目录 |
| `src/studio`、`src/desktop`    | React 工作台与 Electron 本地文件接口           |
| `src/editor`、`src/components` | 内容编辑器、内置区块、自定义组件               |
| `src/portable`                 | 轻量只读页面与离线交付格式                     |
| `src/agent`                    | CLI、MCP 和导出                                |
| `plugins/showai`               | Codex/Claude 技能与平台构建产物                |

开发工具链将 `app-builder-lib` 使用的 `@electron/get` 固定到 `5.1.0`，以移除旧 HTTP 缓存依赖；Node.js 最低版本与该下载器保持一致。

许可证尚未指定。

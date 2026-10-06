# ShowAI 本地浏览器版

本地浏览器版在这台计算机上运行服务，通过现有浏览器显示完整工作台。内容保存在本机文件库中；运行和编辑不需要云端账号。桌面 App、本地浏览器版与 Agent CLI 使用相同的文档格式、版本引用和文件冲突检查。

## 安装与启动

选择符合操作系统和架构的 `ShowAI-browser-版本-系统-架构` 压缩包，解压到长期保存的位置。

| 系统    | 启动工作台                                | Agent CLI    |
| ------- | ----------------------------------------- | ------------ |
| macOS   | 双击 `start.command`，或运行 `./start.sh` | `./showai`   |
| Linux   | 在解压目录运行 `./start.sh`               | `./showai`   |
| Windows | 双击 `start.cmd`                          | `showai.cmd` |

发行包自带独立 Node、工作台网页、CLI、阅读器和本机组件编译器。保持启动终端打开，浏览器会自动打开本机地址。自动打开失败时，复制终端打印的地址到浏览器。按 Ctrl+C 停止服务；关闭浏览器标签页只关闭界面。

服务仅监听 `127.0.0.1`，使用每次启动生成的访问凭据，并检查请求的主机与来源。网页和 API 由同一个服务提供，不能把它当作公网或多人服务器开放。

macOS 的浏览器发行包与桌面 App 可以同时安装。两者选择同一个内容目录，即可读取同一份项目；浏览器会收到 CLI 和 App 的文件变化通知。多个界面编辑同一页面时，旧版本写入会触发冲突处理。

## 内容位置

默认目录为 `~/.showai`。在设置的「通用 → 内容库」选择新位置；这个选择保存在 `~/.showai-browser/settings.json` 中，与桌面 App 的窗口设置独立。

也可以在启动时指定目录。macOS/Linux：

```sh
./start.sh --home /absolute/path/to/library
```

Windows：

```bat
start.cmd --home C:\Users\you\ShowAI
```

`--home` 与 `SHOWAI_HOME` 会固定本次启动的内容位置。服务会登记该目录的 `agent-runtime.json`；Agent 使用这份配置即可选择正确内容库。移动发行包后重新启动一次，刷新配置里的执行路径。

## 文件操作与浏览器行为

导入页面、导入组件源码目录、导出 HTML/JSON/会话片段/整站、准备发布包以及切换内容库，都使用工作台内的本地文件选择器。可输入目录路径、进入子文件夹、切换个人目录/内容库/下载目录，并创建文件夹。双击文件夹进入，选中文件后打开；导出文件已存在时会提示覆盖。

导出直接写入所选磁盘路径；整站输出目录的已有导出文件沿用桌面版的更新行为。显示页面文件会打开操作系统文件管理器，独立页面窗口对应浏览器新标签页。复制启动配置使用浏览器剪贴板权限。

页面沿用自动保存与 Ctrl/Cmd+S。尚未保存、正在保存或存在冲突时，离开标签页会触发浏览器的离开确认；切换到其他应用时会尝试保存。浏览器无法像桌面 App 一样等待异步保存后才关闭，确认离开前应检查保存状态。浏览器崩溃或强制结束进程无法保证待保存草稿落盘。

## Agent 使用

发行包中的 CLI 随时可用，不要求本地服务、App 或浏览器界面正在运行：

```sh
./showai projects create --name "模型调研" --json
./showai projects list --json
./showai runtime register --json
```

Windows 将 `./showai` 替换为 `showai.cmd`。每条命令都可以用 `--home PATH` 指定内容库。设置中的 Agent 启动配置包含可执行路径、CLI 参数和 `SHOWAI_HOME`，现有技能和 `mcp --project PROJECT_ID` 入口继续有效。完整创作命令见 [Agent 使用说明](agent-usage.md)。

## 从源码与发行构建

```sh
npm ci
npm run build:browser
npm run browser
```

日常开发使用 `npm run dev:browser`，直接打开支持热更新的完整工作台，无需预先构建。默认地址为 `http://127.0.0.1:5173`，内容库为 `.showai-dev/library`。前端保存后自动更新；本地服务与 CLI 的相关改动自动构建，确认页面已保存后重启。保存冲突会暂停重启，处理后点击开发标记重试。可使用 `npm run dev:browser -- --port 5174 --home /absolute/library --no-open` 自定义启动。

`npm run dev` 仍是独立单页画布；`npm run browser` 用于运行已经构建的浏览器工作台。

```sh
node dist-runtime/scripts/cli.mjs serve --port 5175 --no-open
npm run package:browser
npm run test:browser:package
```

不指定端口时选择空闲端口。`--port 5175` 固定地址，`--no-open` 只打印地址，`--json` 输出机器可读启动信息。

各系统应在相应平台构建，因为组件编译器包含本机二进制。打包程序下载构建机器对应版本、系统与架构的官方独立 Node，检查 SHA-256，再生成启动器和压缩包。可通过 `SHOWAI_PACKAGE_NODE_VERSION` 显式选择兼容的 Node 版本，默认使用构建机器的版本。Linux 包依赖官方 Node 所需的系统运行库；有图形桌面时通过 `xdg-open` 打开浏览器与文件管理器。

GitHub 的「Browser distributions」工作流可手动运行，为 Linux、Windows 和 macOS 分别构建包、执行本地服务集成测试及发行包测试，并保存压缩包与验收记录。跨平台构建结果以各平台实际测试为准。

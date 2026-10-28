# 开发与测试

**语言：** [English](../development.md) | 简体中文 · [文档](index.zh-CN.md) · [参与开发](CONTRIBUTING.zh-CN.md)

本文说明如何从源码运行 ShowAI、如何让并行实例互不干扰，以及各测试套件的内容和前提条件。每类改动需要哪些检查，见[参与开发](CONTRIBUTING.zh-CN.md)。

## 开发实例

开发启动器构建带热更新的应用。前端改动直接更新；后端、桌面主进程、preload、内置组件源码和 CLI 的改动会在保存后重新构建，并重启本地服务。打开的页面有未保存修改时，重启会等待页面确认保存。

| 命令                                          | 作用                                                 |
| --------------------------------------------- | ---------------------------------------------------- |
| `npm run dev:open`                            | 在后台启动（或复用）桌面开发实例并打开窗口           |
| `npm run dev:open -- browser`                 | 同上，使用浏览器工作台                               |
| `npm run dev:status`                          | 显示运行中的实例：模式、端口、内容库、源码分支和进程 |
| `npm run dev:desktop` / `npm run dev:browser` | 在前台运行桌面或浏览器实例                           |
| `npm run dev`                                 | 仅独立的单页画布，不能代替完整工作台                 |

实例默认使用 5173 端口和内容库 `.showai-dev/library`。并行运行多个实例时，为每个实例分配独立的端口、内容库和（桌面版的）设置目录，避免它们写入彼此的数据：

```sh
mkdir -p /absolute/showai-dev-a/profile /absolute/showai-dev-a/tmp
SHOWAI_USER_DATA=/absolute/showai-dev-a/profile TMPDIR=/absolute/showai-dev-a/tmp \
  npm run dev:open -- --port 5180 --home /absolute/showai-dev-a/library --no-focus
npm run dev:status -- --port 5180 --home /absolute/showai-dev-a/library
```

- `--home` 必须是绝对路径。实例在整个生命周期内保持同一个端口和内容库。
- `SHOWAI_USER_DATA` 隔离桌面应用的设置和 Agent 状态。
- `--no-focus`（配合 `dev:open`）或 `--no-open`（配合 `dev:desktop` / `dev:browser`）启动实例时不把窗口切到前台，适合自动化运行。
- 每个实例的构建产物和启动记录位于 `.showai-dev/<mode>-<port>/`。实例运行期间不要移动或删除它们。
- 测试会写入数据的改动时，不要让开发实例指向日常使用的内容库（`~/.showai`）。

右下角的开发标记显示实例启动时的源码目录、分支和提交。

### 让 Agent 连接实例

`dev:status` 返回的 `cli` 对象包含针对该实例内容库运行 CLI 和 MCP 服务所需的命令、参数和环境，可用于 `template context`、`catalog describe` 等脚本化检查。要让 Claude Code 连接该实例，在 checkout 中运行 `npm run plugin:claude -- --port <port> [--mode browser] --json`，它会把绑定该实例的 `showai-dev` 插件安装到 checkout 的 `.claude/settings.json`。该命令需要实例正在运行，并且已安装 `claude` CLI。删除 checkout 前用 `--remove` 卸载。MCP 会话保持启动时的代码，因此运行时或 Skill 的改动要在实例重建后，在新会话中检查。

### 读懂 `dev:status`

`dev:status` 只读取，不会改变运行中的实例。端口上的实例就绪时退出码为 0，否则为 1，JSON 中说明原因：

- `reason`（`ready` 为 false 时出现）：包含 `code` 和 `message`。可能是 `NOT_LISTENING`（附 `lastSession`，即该端口最近一次的启动记录）、`NO_RESPONSE`、`PORT_IN_USE`、`OTHER_SOURCE_ROOT`、`PREPARING`、`STARTING_BACKEND`、`BUILDING`、`RESTARTING`、`WAITING_FOR_APP_QUIT`（桌面应用正在关闭窗口；同意退出后，`step` 给出正在停止的服务）、`BACKEND_EXITED`（附 `exitCode`）、`BACKEND_NOT_READY`、`BUILD_FAILED`（附 `error`）或 `STOPPING`。`phase` 重复该代码，或为 `RUNNING`。
- `pendingRestart`：后端已就绪，但因为有一次重启在等待，仍在运行启动时的代码（`startedCommit`）。`code` 为 `BUILDING`、`WAITING_FOR_PAGES`、`RESTART_PAUSED`（打开的页面没有确认保存；`blockers` 列出每个页面或共享数据集、窗口 URL 和原因）、`QUIT_BLOCKED`（桌面应用拒绝退出；附 `windows` 和 `record`）或 `BUILD_FAILED`。`since` 是第一个尚未生效的改动请求的时间。处理原因后，点击开发标记重试。
- `stopBlocked`：桌面应用拒绝退出，Ctrl+C 没能停止实例。
- `quitRecord`（桌面版）：应用的 `quit-blocked.json` 路径，其中列出每个拒绝关闭的窗口及原因。
- `instances`：所有正在服务所请求内容库的应用。来源包括应用写入 `<home>/local/instances/<pid>.json` 的在线记录、本 checkout 的开发启动记录（`.showai-dev/*/session.json`），以及命令与 `<home>/agent-runtime.json` 中启动配置一致的进程（用于没有在线记录的旧版应用）。每项包含 `pid`、`mode`、`channel`、`appVersion` 或 `sourceCommit`、`evidence`、`self`（本端口的服务）和 `registered`。
- `registered`：`<home>/agent-runtime.json` 登记的内容，即 Agent 使用的 CLI/MCP 启动方式，以及与之匹配的应用 `pids`。
- `warnings`：`MULTIPLE_INSTANCES`、`REGISTERED_ELSEWHERE`、`REGISTERED_NOT_RUNNING`、`REGISTRATION_MISSING`、`REGISTRATION_INVALID`、`HOME_MISMATCH`、`PENDING_RESTART`、`STOP_BLOCKED` 和 `QUIT_BLOCKED`，每项附 `message`。

删除临时内容库或配置目录前，先停止你启动的进程。保留仍需要的源材料和验证证据，不要把其他运行中实例的目录当作缓存。

## 测试

### 单元与集成测试

Vitest 配置位于 `vite.config.ts` 的 `test` 部分。测试文件为 `src/**/*.test.ts`，在 Node 中运行，设置 `SHOWAI_LANGUAGE=zh-CN`（除非测试指定语言，否则断言中文界面），并关闭公共 CDN 阅读器。`npm test` 会先通过 `pretest` 运行 `npm run build:portable`。

| 文件名                  | 含义                                                           |
| ----------------------- | -------------------------------------------------------------- |
| `*.test.ts`             | 单元或模块测试                                                 |
| `*.integration.test.ts` | 针对临时内容库运行真实的 CLI、MCP 服务、阅读器或浏览器         |
| `*.concurrent.test.ts`  | 多个写入方同时操作一个内容库                                   |
| `scripts/*.test.mjs`    | 用 `node --test` 运行的脚本测试，例如 `npm run test:sync-docs` |

测试使用真实的文件读写和真实的组件编译。每个测试用 `mkdtemp` 在系统临时目录下创建自己的临时内容库；能用真实临时内容库的地方不要使用 mock。常用夹具的辅助函数在 `src/test/`。在 Windows 上，没有开发者模式或符号链接权限时，文件符号链接测试会被跳过。

部分测试读取构建产物，单独运行它们之前先运行 `npm run build`：

| 产物                         | 构建命令                                       | 读取它的测试（示例）                     |
| ---------------------------- | ---------------------------------------------- | ---------------------------------------- |
| `dist-portable`              | `npm run build:portable`（`pretest` 也会执行） | 阅读器、导出和呈现测试                   |
| `dist-agent`、`dist-runtime` | `npm run build` 或 `npm run build:browser`     | CLI、MCP、模板流程和浏览器服务的集成测试 |
| `dist-cdn`                   | `npm run build:cdn`                            | `src/core/reader-source-worker.test.ts`  |

单独运行一个文件：`npx vitest run src/path/to/file.test.ts`。

### 冒烟测试

冒烟测试驱动真实的桌面应用或浏览器工作台，输出写入 `output/playwright/`。先运行一次 `npx playwright install chromium` 安装 Chromium。

| 命令                                                         | 覆盖范围                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `npm run test:desktop`                                       | 完整构建，然后运行窗口、内容库、组件目录和目录选择的 Electron 冒烟测试 |
| `npm run test:component-gallery`                             | 完整构建，然后测试组件浏览器：分类、预览和版本                         |
| `npm run test:containers`、`npm run test:containers:desktop` | 浏览器和桌面中的 Page 与 Board 交互                                    |
| `npm run test:dev`、`npm run test:dev -- desktop`            | 在隔离副本上测试开发启动器、热更新和重启                               |
| `npm run test:browser`                                       | 浏览器版服务                                                           |
| `npm run test:server`                                        | 同步服务                                                               |
| `npm run test:cloud-mcp`                                     | HTTP MCP 网关                                                          |

启动器和容器冒烟测试结束后会删除隔离的源码副本和内容库。排查问题时设置 `SHOWAI_KEEP_TEST_FIXTURES=1` 可以保留它们，用完后请自行删除。

### 持续集成

`.github/workflows/check.yml` 在推送到 `main` 和提交拉取请求时运行：

- **Linux：** `npm run check`、`npm test`、`npm run build`、`npm run test:whiteboard` 和 `npm audit --audit-level=high`。
- **Windows：** `npm run check`、Vitest 套件、`npm run build`，以及桌面和界面冒烟测试。

其他工作流（浏览器安装包、墨迹可移植性）在发版前手动运行。

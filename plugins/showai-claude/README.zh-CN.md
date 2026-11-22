# ShowAI Agent 插件

**语言：** [English](README.md) | 简体中文 · [文档目录](https://github.com/Renaissance-Mind/ShowAI/blob/main/docs/i18n/README.zh-CN.md)

ShowAI 让 Agent 用界面回答——可以交互、可以归档、在使用中不断进化。它由两部分组成：本插件为 Agent 提供 ShowAI 的工具（stdio MCP launcher）和六个 Skill；ShowAI App 保存页面，并提供插件连接的运行时。兼容性以运行时报告的实际能力为准。

## 安装

**推荐从 ShowAI App 安装。** 从 [GitHub Releases](https://github.com/Renaissance-Mind/ShowAI/releases/latest) 下载并打开 App，在欢迎页或「设置 → 外部 Agent 插件」中为 Claude Code、Codex 或 Antigravity 安装插件。先安装 Agent，并确保其命令行工具可用。App 提供插件和运行时，无需源码，也无需单独安装 Node.js。安装后 Claude Code 或 Antigravity 重启会话，Codex 刷新插件或重启，然后新开对话。连接使用 App 当前的内容库；切换内容库或移动 App 后点「更新并启用」。如果 App 提示插件来源冲突，先在宿主中停用提示列出的插件，再安装 App 版本。详见[在 Claude Code 与 Codex 中使用](https://github.com/Renaissance-Mind/ShowAI/blob/main/docs/i18n/codex.zh-CN.md)。

### 从源码安装

源码安装需要 Node.js 22.12+ 和 PATH 中的 Codex CLI。先构建/启动 ShowAI，或登记已安装的独立运行时，使目标内容库存在 agent-runtime.json。在源码仓库执行：

```sh
npm run plugin:install -- --json
# 拉取更新后：
npm run plugin:update -- --json
```

安装器使用官方 Codex 插件命令，核验启用状态、版本与文件指纹，这次源码安装的回执位于 `artifacts/codex-plugin-install.json`。安装完成、宿主能力刷新和会话加载是三个环节。按宿主支持的方式刷新，并在新对话确认当前工具与 Skill。

Claude Code 的日常插件从 App 安装，连接稳定版。开发时先启动一个开发实例（`npm run dev:open -- --port <端口> --home <内容库>`），再在该源码目录（主目录或 worktree）执行：

```sh
npm run plugin:claude -- --port <端口> --json
```

Claude Code 在主目录启用 `showai-dev`，在 worktree 启用 `showai-dev-<worktree 名>`，名称取自 Git 的 worktree 目录。开发插件使用所选实例的运行时与内容库。全局启用了 `showai@showai-desktop` 时，两套插件在该目录下都可用，测试时按名称选择开发插件。

安装器将回执写入当前源码目录的 `artifacts/claude-plugin-install.json`。删除 worktree 前，在该目录运行 `npm run plugin:claude -- --remove` 卸载开发插件。worktree 已删除时，运行 `npm run plugin:claude -- --prune` 清理遗留插件。

Antigravity（PATH 中有 `agy`）可连接已登记运行时或运行中的开发实例：

```sh
npm run plugin:antigravity -- --json
# 或绑定运行中的开发实例：
npm run plugin:antigravity -- --port <端口> --json
```

`--remove` 从 Antigravity 卸载插件。回执位于 artifacts/antigravity-plugin-install.json。

### DeepSeek Harness

首次使用时先打开一次 DeepSeek Harness，再完全退出。在 ShowAI 中选择「设置 → 外部 Agent 插件 → DeepSeek Harness → 安装插件」。ShowAI 调用 Harness 自带的包管理器安装并启用[本机插件包](https://github.com/Renaissance-Mind/ShowAI/blob/main/plugins/showai-deepseek/README.md)，随后核验实际链接。打开 Harness 即可使用六个 Skills、本机 MCP 工具、对话预览、会话侧栏和全局工作台。

切换内容库或更新 ShowAI 后，点「更新并启用」并重新打开 Harness。源码开发时，`npm run plugin:dsh` 仍可单独准备插件包。Harness 退出后，用命令输出的目录执行 `dsh plugin --profile desktop add "link:/插件包的绝对路径"`，也可在 Harness 的「插件 → 添加插件」选择该目录并点「立即启用」。

设置页会列出可能需要清理的旧注册。Harness 的默认配置目录为 `~/.dsh`。

- 旧版 `@showai/dsh-showai-preview` bundle：在 Harness「插件」中打开它并卸载；
- `$DSH_HOME/profiles/desktop/cordis.patch.yml` 中手写的 `mcp-showai` 配置：删除整段；
- 复制到 `$DSH_HOME/skills` 的 ShowAI Skill 文件夹：删除，否则会覆盖 bundle 自带的 Skill。

## Skill 与任务分工

| Skill                                                    | 用途                                           |
| -------------------------------------------------------- | ---------------------------------------------- |
| [use-showai](skills/use-showai/SKILL.md)                 | 总入口：分流、连接、查找、阅读与管理内容       |
| [show-visual](skills/show-visual/SKILL.md)               | 在对话中直接展示 1–5 个组件，不保存            |
| [show-document](skills/show-document/SKILL.md)           | 创作与修改作品：完整制作流程、保存、展示与导出 |
| [create-component](skills/create-component/SKILL.md)     | 可复用 React 表达能力                          |
| [create-template](skills/create-template/SKILL.md)       | 可复用模板文件夹与方法                         |
| [collaborate-canvas](skills/collaborate-canvas/SKILL.md) | 画布协作、多端配对与保存状态                   |

在聊天里做可视化时，用 show-visual 编写原创 HTML，直接调用 `show_component({html})`。多幅图按顺序传入数组，每次最多五幅。用户明确要求使用现有 ShowAI 组件时才查询目录，已知 ID 可直接读使用说明。需要核对宿主显示方式时用 `showai_capabilities({view:"presentation"})`。 项目操作从 use-showai 开始。

## 运行时与内容库

launcher 只解析目标库登记的运行时，要求 showai-mcp-v1 与所需工作流协议。失败明确报错，不自动切换库。启动前在宿主配置：

| 配置                    | 用途                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| SHOWAI_HOME             | 内容库，默认 ~/.showai                                                                                    |
| SHOWAI_PROJECT_ID       | 可选项目绑定                                                                                              |
| SHOWAI_TEMPLATES        | 启动模板，需同时绑定项目                                                                                  |
| SHOWAI_PRESENTATION_DIR | 宿主可访问的展示目录                                                                                      |
| SHOWAI_HOST_DISPLAY     | show_component 进入该宿主对话的方式：mcp-app、codex-visualize、fragment-file、model-html、image 或 native |

参见[运行时说明](skills/use-showai/references/runtime.md)。更新插件不自动升级应用或正在运行的 MCP。内置 Agent 由 AgentHost 提供项目绑定连接，任务私有插件移除外部 library launcher。

## 展示

page_present 返回完整离线 HTML/source 与聊天预览。预览容纳时使用本地阅读器，超预算可用固定发布阅读器在线回退；delivery.compact/online 使用发布阅读器。SHOWAI_READER_CDN=off 保持阅读器离线。

宿主可以显示 MCP Apps、使用返回的 Codex 本机可视化路径，或交付完整 HTML/source。显示能力取决于宿主。路径与 HTTP 预览是快照，项目中源页面持续可编辑。详见[对话展示](skills/use-showai/references/host-display.md)。

## 通用插件与手动连接

五个专用包面向同一台电脑上的 Agent 和 ShowAI，一次安装六个 Skills 与本机 MCP 启动配置。DeepSeek Harness 通过宿主 CLI 安装并启用本机插件包，Kimi Work 在宿主里注册并安装本地插件。

在其他客户端使用时，可在桌面「设置 → 外部 Agent 插件」安装，也可从源码生成通用目录：

```sh
npm run package:plugin -- --out NEW_DIRECTORY
```

通用包提供六个 Skills 和离线[连接向导](skills/use-showai/references/connect-mcp.md)。有已知连接时，附上 `--mcp local`（使用已登记的本机 ShowAI 运行时）或 `--mcp <MCP地址>`。本机版可用 `--runtime-config <绝对路径>` 绑定指定运行时。远程版可用 `--mcp-auth oauth` 声明 OAuth。旧命令中的 `--mcp-url` 只把地址写入 README 供手动填写，`--chatgpt-app` 引用已注册的 ChatGPT 连接。任务需要 MCP、工具不可用时，接入向导按宿主和实际环境补齐配置。

ChatGPT 网页通过公网 HTTPS 和 OAuth 连接。Grok Bot 可选同一 tailnet 的私网设备授权或公网 HTTPS。其他客户端按运行位置选择本机 stdio、局域网或远程 HTTP。在客户端实际发起只读调用核验，见[在 Agent 中使用](https://showai.renaissancemind.ai/doc/agent-hosts)。

### Cursor、Qoder 和 WorkBuddy

先启动 ShowAI 登记内容库，在源码目录运行对应命令。桌面宿主用 `node` 启动包内 MCP。要绑定另一个已登记的内容库，可加入 `--runtime-config /绝对路径/agent-runtime.json`。

| 宿主      | 生成安装包                                                                      | 安装                                                                                                                         |
| --------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Cursor    | `npm run package:plugin -- --host cursor --mcp local --out showai-cursor`       | 把生成的目录放到 `~/.cursor/plugins/local/`，重载 Cursor 窗口，在新的本机对话使用插件。                                      |
| Qoder     | `npm run package:plugin -- --host qoder --mcp local --out showai-qoder.zip`     | 在 Qoder 桌面版打开「扩展 → 插件 → 添加插件 → 导入插件」，选择 ZIP。                                                         |
| WorkBuddy | `npm run package:plugin -- --host workbuddy --mcp local --out showai-workbuddy` | 将生成的目录注册为 WorkBuddy 本地插件市场。也可以从 ShowAI 复制本机 MCP 配置，在「连接器 → 自定义连接器 → 添加 MCP」中填写。 |

在 macOS 上可用 WorkBuddy 自带的 CodeBuddy CLI 安装本地市场。在源码目录生成 `showai-workbuddy` 后执行以下命令。

```sh
workbuddy_cli=/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs
CODEBUDDY_CONFIG_DIR="$HOME/.workbuddy" node "$workbuddy_cli" plugin marketplace add "$PWD/showai-workbuddy"
CODEBUDDY_CONFIG_DIR="$HOME/.workbuddy" node "$workbuddy_cli" plugin install showai-workbuddy@showai-workbuddy-local
```

在新建的本机任务里用 `projects_list` 核对内容库。三个包共用六个 Skill，安装格式和交付方式按宿主适配：

| 宿主 | 对话中 | 保存的页面与工作台 |
| --- | --- | --- |
| Cursor | 对话中展示可交互的 MCP App | Agent 可通过 MCP 读取和续改原页；用户在 ShowAI 中直接编辑，也可以在 Cursor 的 Browser 面板打开导出的 HTML。 |
| Qoder | 对话中展示可交互的 MCP App | 本机插件在「更多」中提供 ShowAI 全局工作台，在任务的应用面板提供工作台。可以让 Agent 在右侧编辑器打开原页，也可以自行选择工作台。 |
| WorkBuddy | 对话中展示可交互的 MCP App | Agent 可通过 MCP 读取和续改原页；用户可在 ShowAI 中直接编辑。 |

Qoder 的工作台入口需要本机插件和支持 Qoder 工作台的已登记 ShowAI 运行时。旧运行时可能仍提供基础 MCP 工具，但不会出现工作台入口；使用前需构建并登记当前源码运行时，或更新已安装的运行时。远程 MCP 连接以实际提供的展示能力为准。WorkBuddy 使用其原生插件清单和 MCP 配置，除检查插件管理页外，也需要在新任务中确认工具可用。

## 宿主包与公共源码

公共工作流只维护 `plugins/showai/skills`，宿主展示契约分别维护在 `plugins/showai/host-adapters`。运行 `npm run package:plugin` 自动生成 Codex、Claude Code、Antigravity 和 Kimi 的安装内容；DeepSeek 准备插件时绑定自己的适配，远程 MCP Apps 使用原生视图指南。

安装包的主目录使用 `plugins/showai-<宿主>/`。Kimi Work 使用 `plugins/showai-kimi/`，DeepSeek Harness 的 bundle 源码位于 `plugins/showai-deepseek/`。打包时同步生成旧安装入口 `plugins-kimi/showai/` 和 `plugins/dsh-showai/`，沿用原插件 ID。

Codex 市场指向 `plugins/showai-codex`，Claude Code 市场指向 `plugins/showai-claude`，Antigravity 安装包位于 `plugins/showai-antigravity`，插件身份沿用 showai@renaissance-mind。生成目录随仓库提交，供全新克隆直接安装。打包时将当前宿主的常规交付步骤写入 show-visual 和 show-document，完整指南放在 host-adapter.md。host-profile.json 记录适配身份、显示声明和文件指纹。App 安装入口使用同一套绑定逻辑。Codex 和 Antigravity 默认使用 MCP Apps 原生视图与原页卡片，宿主缺少原生视图时使用文件式交付。各宿主加载与 MCP 重连分别核验。

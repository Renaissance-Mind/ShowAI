# ShowAI Agent 插件

**语言：** [English](README.md) | 简体中文 · [文档目录](../../docs/i18n/index.zh-CN.md)

ShowAI 让 Agent 用界面回答——可以交互、可以归档、在使用中不断进化。它由两部分组成：本插件为 Agent 提供 ShowAI 的工具（stdio MCP launcher）和八个 Skill；ShowAI App 保存页面，并提供插件连接的运行时。兼容性以运行时报告的实际能力为准。

## 安装

**推荐从 ShowAI App 安装。** 从 [GitHub Releases](https://github.com/Renaissance-Mind/ShowAI/releases/latest) 下载并打开 App，在欢迎页或「设置 → 插件」中为 Claude Code 或 Codex 安装插件。先安装 Agent，并确保其命令行工具可用。App 提供插件和运行时，无需源码，也无需单独安装 Node.js。安装后 Claude Code 重启会话，Codex 刷新插件或重启，然后新开对话。连接使用 App 当前的内容库；切换内容库或移动 App 后点「更新并启用」。已有其他来源的 ShowAI 插件时，先在 Agent 中停用原插件，再安装 App 版本。详见[在 Claude Code 与 Codex 中使用](../../docs/i18n/codex.zh-CN.md)。

### 从源码安装

源码安装需要 Node.js 22.12+ 和 PATH 中的 Codex CLI。先构建/启动 ShowAI，或登记已安装的独立运行时，使目标内容库存在 agent-runtime.json。在源码仓库执行：

```sh
npm run plugin:install -- --json
# 拉取更新后：
npm run plugin:update -- --json
```

安装器使用官方 Codex 插件命令，核验启用状态、版本与文件指纹，回执位于 artifacts/codex-plugin-install.json。安装完成、宿主能力刷新和会话加载是三个环节。按宿主支持的方式刷新，并在新对话确认当前工具与 Skill。

Claude Code 在仓库根目录执行：

```sh
claude plugin marketplace add ./
claude plugin install showai@renaissance-mind
```

### DeepSeek Harness

DeepSeek Harness 由自己安装插件，因此 ShowAI 准备一个完整 bundle（[dsh-showai](../dsh-showai/README.md)），包含绑定当前运行时和内容库的 MCP 工具、上述 Skill 与对话内页面预览。App 中打开「设置 → 插件 → DeepSeek Harness → 准备插件」。源码方式在已登记运行时后执行：

```sh
npm run plugin:dsh
```

然后在 DeepSeek Harness 中执行一次：「插件 → 添加插件」，粘贴显示的 bundle 路径，选择「立即启用」并重启 Harness。更新 ShowAI（App 或源码）、切换内容库或登记的运行时变化后，再准备一次：它会重写同一目录，重启 Harness 即可加载，无需重新添加。安装器会列出需要先清理的旧手动配置（`$DSH_HOME` 未设置时为 `~/.dsh`）：

- 旧版 `@showai/dsh-showai-preview` bundle：在 Harness「插件」中打开它并卸载；
- `$DSH_HOME/profiles/desktop/cordis.patch.yml` 中手写的 `mcp-showai` 配置：删除整段；
- 复制到 `$DSH_HOME/skills` 的 ShowAI Skill 文件夹：删除，否则会覆盖 bundle 自带的 Skill。

## Skill 与任务分工

| Skill                                                      | 用途                             |
| ---------------------------------------------------------- | -------------------------------- |
| [use-showai](skills/use-showai/SKILL.md)                   | 连接身份、发现、查找、阅读与分工 |
| [plan-presentation](skills/plan-presentation/SKILL.md)     | 读者意图、材料与呈现逻辑         |
| [design-presentation](skills/design-presentation/SKILL.md) | 逐幕设计稿、布局与交互           |
| [show-document](skills/show-document/SKILL.md)             | 制作、续改、保存、展示与导出     |
| [review-presentation](skills/review-presentation/SKILL.md) | 检查理解、修订与复核             |
| [create-component](skills/create-component/SKILL.md)       | 可复用 React 表达能力            |
| [create-template](skills/create-template/SKILL.md)         | 可复用模板文件夹与方法           |
| [collaborate-canvas](skills/collaborate-canvas/SKILL.md)   | 画布协作、多端配对与保存状态     |

Agent 文档操作使用 MCP，先读取 guide() 并发现能力与项目。正式成果先保存到项目再 page_present；明确独立交付使用 render_document。详细方法由同源 Skill 维护，本页用于安装与接入。

## 运行时与内容库

launcher 只解析目标库登记的运行时，要求 showai-mcp-v1 与所需工作流协议。失败明确报错，不自动切换库。启动前在宿主配置：

| 配置                    | 用途                     |
| ----------------------- | ------------------------ |
| SHOWAI_HOME             | 内容库，默认 ~/.showai   |
| SHOWAI_PROJECT_ID       | 可选项目绑定             |
| SHOWAI_TEMPLATES        | 启动模板，需同时绑定项目 |
| SHOWAI_PRESENTATION_DIR | 宿主可访问的展示目录     |

参见[运行时说明](skills/use-showai/references/runtime.md)。更新插件不自动升级应用或正在运行的 MCP。内置 Agent 由 AgentHost 提供项目绑定连接，任务私有插件移除外部 library launcher。

## 展示

page_present 返回完整离线 HTML/source 与聊天预览。预览容纳时使用本地阅读器，超预算可用固定发布阅读器在线回退；delivery.compact/online 使用发布阅读器。SHOWAI_READER_CDN=off 保持阅读器离线。

宿主可以显示 MCP Apps、使用返回的 Codex 本机可视化路径，或交付完整 HTML/source。显示能力取决于宿主。路径与 HTTP 预览是快照，项目中源页面持续可编辑。详见[对话展示](skills/show-document/references/conversation-display.md)。

## 网页 ChatGPT 与远程包

普通 ChatGPT 网页使用托管 MCP 连接并通过 guide 获取工作流，无需本机 Skill 或 ZIP。见 [ChatGPT 接入](../../docs/i18n/chatgpt.zh-CN.md)。

运营者可以从相同 Skill 生成 HTTP/OAuth 包：

```sh
npm run package:plugin -- --mcp-url HTTPS_MCP_URL --out NEW_DIRECTORY
```

输出名为 showai-cloud，移除本机 launcher，使用 OAuth DCR。已有 ChatGPT 注册连接可加 --chatgpt-app asdk_app_ID。与本机插件并存安装：

```sh
node scripts/install-codex-plugin.mjs --remote-url HTTPS_MCP_URL --marketplace-root DIRECTORY
```

安装器使用独立 marketplace 并核验文件，包内不包含凭据。部署与公开提交是独立发行操作。参见 [Agent 接入](../../docs/i18n/agent-integration.zh-CN.md)。

边写边画、位置参考和 iPad/Mac 配对见 [collaborate-canvas](skills/collaborate-canvas/SKILL.md)。

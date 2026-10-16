# ShowAI Agent 插件

**语言：** [English](README.md) | 简体中文 · [文档目录](../../docs/i18n/index.zh-CN.md)

本机 **0.17.0** 插件提供七个 Skill 与 stdio MCP launcher，用于读取、创建、续改和展示 ShowAI 内容。应用/运行时独立安装，仓库应用源码版本为 **0.9.0**，兼容性以实际运行时能力为准。

## 本机安装

桌面 App 用户打开「设置 → Agent → 本地连接」，即可给 Codex 或 Claude Code 安装插件。先安装宿主并确保其插件管理 CLI 可用。App 提供插件和运行时，无需下载源码或单独安装 Node.js；安装后刷新或重启宿主。连接使用所选内容库，切换库或移动 App 后再次更新插件。已有其他来源的 ShowAI 插件时，先在宿主中停用原插件，再安装 App 版本。

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

## Skill 与任务分工

| Skill                                                      | 用途                             |
| ---------------------------------------------------------- | -------------------------------- |
| [use-showai](skills/use-showai/SKILL.md)                   | 连接身份、发现、查找、阅读与分工 |
| [plan-presentation](skills/plan-presentation/SKILL.md)     | 读者目标、证据与理解路径         |
| [design-presentation](skills/design-presentation/SKILL.md) | 图形对象、布局、状态与交互       |
| [show-document](skills/show-document/SKILL.md)             | 制作、续改、保存、展示与导出     |
| [review-presentation](skills/review-presentation/SKILL.md) | 检查理解、修订与复核             |
| [create-component](skills/create-component/SKILL.md)       | 可复用 React 表达能力            |
| [create-template](skills/create-template/SKILL.md)         | 可复用模板文件夹与方法           |

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

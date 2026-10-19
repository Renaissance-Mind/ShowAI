# 在 Claude Code 与 Codex 中使用 ShowAI

**语言：** [English](../codex.md) | 简体中文 · [文档目录](index.zh-CN.md)

连接 ShowAI 后，Claude Code 与 Codex 可以用界面而不是一段文字来回答，把它保存为 ShowAI 项目中的页面，之后还能在你的修改上继续。插件为 Agent 提供 ShowAI 的工具和八个 Skill；ShowAI App 负责保存页面，并提供插件连接的运行时。**先安装 App，插件随 App 提供。**

## 从 App 安装插件

需要 ShowAI 桌面 App（见[快速上手](quick-start.zh-CN.md#1-安装-showai)），以及已安装并登录的 Claude Code 或 Codex。

1. 在 ShowAI 中打开插件面板：首次启动时的欢迎页，或随时打开「设置 → 插件」。
2. 在 Claude Code 或 Codex 旁点「安装插件」，等待显示「已安装并启用」。
3. Claude Code 重启会话；Codex 刷新插件或重启 Codex。然后新开一个对话。

ShowAI 通过 Agent 自己的插件命令安装，因此需要 Agent 的命令行工具可用；macOS 还会检查常见 Codex App 安装位置中的内置 CLI。App 提供插件文件和可执行的运行时，无需 ShowAI 源码，也无需单独安装 Node.js。安装后，ShowAI 会核验安装文件与启用状态。

插件连接 App 当前的内容库。切换内容库或移动 App 后，点「更新并启用」。如果已经启用了其他来源的 ShowAI 插件，先在 Agent 中停用它，再点「重新检测」。

## 确认连接

安装插件、重新加载 Agent、对话取得新工具是三个分开的环节；已经打开的对话仍使用旧的工具列表。在新对话中请求一个界面：

> 用 ShowAI 帮我做一个房贷计算器：房价、首付比例、利率和贷款年限可以调整，显示月供和总利息。

Agent 应当调用 ShowAI 工具、保存页面并展示出来。如果它只用文字回答，见 [Agent 找不到 ShowAI 时](quick-start.zh-CN.md#agent-找不到-showai-时)。

## 选择内容库与项目

从 App 安装的插件使用 App 的内容库。自行配置启动方式的 Agent 可以在 MCP 进程启动前设置：

| 配置                      | 用途                                           |
| ------------------------- | ---------------------------------------------- |
| `SHOWAI_HOME`             | 本地内容库；未指定时使用当前用户的 `~/.showai` |
| `SHOWAI_PROJECT_ID`       | 可选，将连接锁定到指定项目                     |
| `SHOWAI_TEMPLATES`        | 可选启动模板，需同时指定 SHOWAI_PROJECT_ID     |
| `SHOWAI_PRESENTATION_DIR` | 宿主可读取的展示目录                           |

**运行期间不切换内容库**。本机启动入口只查找所选内容库中登记的运行时；版本不兼容或连接失败会明确报错，不自动改用其他库或独立 HTML。只有远程连接时，使用已授权的 HTTP MCP 地址与项目，不读取本机配置。完整接入说明见 [Agent 接入](agent-integration.zh-CN.md)。

## Agent 怎样处理页面

连接 ShowAI 的 Agent 都按同样的步骤工作；了解这些步骤，便于检查 Agent 做了什么。

1. **找到内容。** `projects_list` 或绑定的 `project_context` → `pages_list` / `library_search` → `page_read`。只读查找不会创建项目。新内容保存到你指定的项目；没有指定时，本机连接可用 `project_resolve` 根据 Agent 的工作目录定位项目。
2. **读取相应指南。** `show-document` 按理解意图、收集材料、呈现逻辑、设计稿四个阶段完成一份页面。准备数据前，Agent 先读取组件指南和精确的参数说明。
3. **谨慎保存。** **读取完整 Page**，保留稳定的节点 ID，携带当前 hash/revision 调用 `page_apply` 或 `page_save`。**冲突必须比较两份内容后有意识地合并**，不能刷新版本后直接覆盖。
4. **展示已保存的页面。** `page_present` 返回完整 HTML/source 和 inline 预览。支持 MCP Apps 的 Agent 直接显示阅读器；Codex 文件式可视化使用实际返回的 `delivery.inline` 路径；其他情况下 Agent 交给你 HTML 文件。

导出是快照，源页面后续修改不会更新旧的导出文件。预览过大时，Agent 展示选定的内容块，同时保留完整页面交付。**用户明确只要独立文件时**才用 `render_document`，它不保存到项目。

基于 ShowAI 开发 Agent 时，先调用 `guide()`，再调用 `showai_capabilities` 和 `project_context`，确认实际连接。

## 从源码安装

开发 ShowAI 或从源码运行时使用这种方式。需要 **Node.js 22.12+** 和支持 `showai-mcp-v1` 的运行时。先启动一次构建好的 App，或运行 `npm run runtime:register`，让目标内容库登记 `agent-runtime.json`。

Codex（需要 PATH 中有 Codex CLI）：

```sh
npm run plugin:install -- --json
```

拉取新代码后刷新已安装的插件：

```sh
npm run plugin:update -- --json
```

安装器使用官方 Codex 插件命令，并核验版本、启用状态和文件指纹。

Claude Code，在仓库根目录执行：

```sh
claude plugin marketplace add ./
claude plugin install showai@renaissance-mind
```

各个 Skill 与 DeepSeek Harness 的接入见[插件说明](../../plugins/showai/README.zh-CN.md)。

## 诊断

使用设置中显示的运行时启动配置，或所选内容库的 `agent-runtime.json`。CLI 用于运行时登记、服务启动、诊断、运维与脚本，具体命令见[脚本参考](agent-usage.zh-CN.md)；Agent 的文档操作通过 MCP 完成。报告问题时，分别写明插件、App 和托管 MCP 的版本。

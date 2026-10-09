# 在 Codex 中使用 ShowAI

ShowAI 插件提供四个 Skill 和本机 MCP 启动入口。Agent 通过 MCP 创建、读取、修改和展示内容；正式页面保存到所选 ShowAI 项目。ShowAI 软件提供存储、阅读器与组件编译能力，**需要与插件分别安装**。

## 安装与连接

本机需要 **Node.js 22.12+**、Codex 和支持 `showai-mcp-v1` 的 ShowAI 运行时。ShowAI 启动或 `runtime register` 会在目标内容库中登记 `agent-runtime.json`。

在源码仓库中执行：

```sh
npm run plugin:update -- --json
```

安装器使用官方 Codex 插件命令，并核验版本、启用状态和文件指纹。

宿主刷新后，**确认 ShowAI MCP 工具实际可见**，再调用 `showai_capabilities` 和 `project_context`。安装文件更新、工具加载和当前会话取得新说明是不同环节。

### 选择内容库与项目

| 配置 | 用途 |
| --- | --- |
| `SHOWAI_HOME` | 本地内容库；未指定时使用当前用户的 `~/.showai` |
| `SHOWAI_PROJECT_ID` | 可选，将连接锁定到指定项目 |
| `SHOWAI_PRESENTATION_DIR` | 宿主可读取的展示目录 |

配置必须在启动时明确，**运行期间不切换内容库**。旧运行时或连接失败会明确报错，不自动改用其他库或独立 HTML。

只有远程连接时，使用已授权的 HTTP MCP 地址与项目，不读取本机配置。完整接入说明见 [Agent 接入](agent-integration.md)。

## 文档工作流

### 1. 找到内容

已有内容：`projects_list` 或绑定的 `project_context` → `pages_list` / `library_search` → `page_read`。

新正式内容：用户指定的项目优先；本机 library 连接可用 `project_resolve` 根据可信宿主工作目录定位项目。远程和项目绑定连接使用已有授权项目。

### 2. 修改并保存

**读取完整 Page** → 携带 hash/revision 调用 `page_apply` 或 `page_save` → 核对回执。

**冲突必须比较与处理**，不刷新版本后直接覆盖。

### 3. 展示结果

保存后 `page_present` 返回完整 HTML/source 和 inline 预览。MCP Apps 由宿主显示；Codex 文件式可视化使用实际 `delivery.inline` 路径。

HTML 导出位置与源 Page 归属不同，源页面后续修改不会自动更新旧导出文件。

**用户明确只要独立文件时**才用 `render_document`。普通文档任务不因连接或显示失败改为不入库交付。

## CLI 的职责

CLI 用于运行时登记、服务启动、诊断、运维与脚本，具体命令见 [脚本参考](agent-usage.md)。它不是 Agent 每次操作文档时的第二套决策路径。例如宿主运行 `showai mcp --home /ABSOLUTE_LIBRARY` 启动连接后，Agent 通过 MCP 调用页面工具。

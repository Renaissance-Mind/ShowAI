# 在 Codex 中使用 ShowAI

**语言：** [English](../codex.md) | 简体中文 · [文档目录](index.zh-CN.md)

ShowAI 插件提供七个 Skill 和本机 MCP 启动入口。Agent 通过 MCP 创建、读取、修改和展示内容；正式页面保存到所选 ShowAI 项目。ShowAI 软件提供存储、阅读器与组件编译能力，**需要与插件分别安装**。

## 安装与连接

桌面 App 用户打开 **设置 → Agent → 本地连接 → 安装 ShowAI 插件**，点击 Codex 旁的「安装插件」。同一面板也支持 Claude Code。先安装目标宿主，并确保其插件管理命令可用；macOS 还会检查常见 Codex App 安装位置中的内置 CLI。

App 提供插件文件和运行时，无需下载 ShowAI 源码或单独安装 Node.js。安装后会核验文件与启用状态。插件连接当前内容库；切换内容库或移动 App 后，点击「更新并启用」，再刷新或重启宿主以加载新工具。如果已有其他来源的 ShowAI 插件，请先在宿主中停用原插件，再安装 App 版本。

从源码安装时，本机需要 **Node.js 22.12+**、Codex 和支持 `showai-mcp-v1` 的 ShowAI 运行时。ShowAI 启动或 `runtime register` 会在目标内容库中登记 `agent-runtime.json`。

在源码仓库中首次安装：

```sh
npm run plugin:install
```

拉取新代码后刷新已安装的插件：

```sh
npm run plugin:update
```

安装器使用官方 Codex 插件命令，并核验版本、启用状态和文件指纹；加 `-- --json` 可输出机器可读的结果。

安装完成后，通过宿主支持的方式刷新能力，再新建 Codex 会话，**确认 ShowAI MCP 工具可见**，先调用 `guide()`，再调用 `showai_capabilities` 和 `project_context`。已打开的会话不会自动加载新安装的插件。

### 选择内容库与项目

| 配置                      | 用途                                           |
| ------------------------- | ---------------------------------------------- |
| `SHOWAI_HOME`             | 本地内容库；未指定时使用当前用户的 `~/.showai` |
| `SHOWAI_PROJECT_ID`       | 可选，将连接锁定到指定项目                     |
| `SHOWAI_TEMPLATES`        | 可选启动模板，需同时指定 SHOWAI_PROJECT_ID     |
| `SHOWAI_PRESENTATION_DIR` | 宿主可读取的展示目录                           |

配置必须在启动时明确，**运行期间不切换内容库**。旧运行时或连接失败会明确报错，不自动改用其他库或独立 HTML。

只有远程连接时，使用已授权的 HTTP MCP 地址与项目，不读取本机配置。完整接入说明见 [Agent 接入](agent-integration.zh-CN.md)。

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

CLI 用于运行时登记、服务启动、诊断、运维与脚本，具体命令见 [脚本参考](agent-usage.zh-CN.md)。它不是 Agent 每次操作文档时的第二套决策路径。例如宿主运行 `showai mcp --home /ABSOLUTE_LIBRARY` 启动连接后，Agent 通过 MCP 调用页面工具。

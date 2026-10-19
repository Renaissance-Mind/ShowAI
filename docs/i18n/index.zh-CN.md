# ShowAI 文档

**语言：** [English](../README.md) | 简体中文

ShowAI 是可进化的人机交互界面：Agent 的回答不再只是一段文字，而是一个可以交互、可以归档、在使用中不断进化的界面。初次使用从快速上手开始。

指南对应当前源码。已发布的 App、插件和托管服务分别更新；下载见 [GitHub Releases](https://github.com/Renaissance-Mind/ShowAI/releases)。

## 开始使用

| 文档                                             | 内容                                  |
| ------------------------------------------------ | ------------------------------------- |
| [快速上手](quick-start.zh-CN.md)                 | 安装、连接 Agent、第一个界面与分享    |
| [在 Claude Code 与 Codex 中使用](codex.zh-CN.md) | 从 App 安装插件、项目与页面工作流     |
| [内置 Agent](agent-host.zh-CN.md)                | 本机/API、云端与配对 Mac 执行         |
| [Page 与 Board](page-surface.zh-CN.md)           | 嵌套容器、绘画、阅读与快捷键          |
| [本地浏览器版](local-browser.zh-CN.md)           | 在 macOS、Linux 与 Windows 从源码运行 |
| [网页版 ChatGPT（邀请制）](chatgpt.zh-CN.md)     | 账号、托管 MCP、授权与更新            |

## 组件与模板

| 文档                                      | 内容                                 |
| ----------------------------------------- | ------------------------------------ |
| [组件与模板](catalog-lifecycle.zh-CN.md)  | 作用域、不可变版本、组合与发布       |
| [Skills 与工作流程](skills.zh-CN.md)      | 八个 Skill 与任务分工                |
| [模板文件夹](template-bundles.zh-CN.md)   | 元信息、四阶段指南与组件库           |
| [组件参数](component-parameters.zh-CN.md) | 生成式参数参考、省略行为与关系校验   |
| [G2 数据图表](g2-components.zh-CN.md)     | 43 种图表、数据源与字段映射          |
| [思维导图](mindmap.zh-CN.md)              | 布局、快捷键、数据与导出             |
| [图形组件](diagram-components.zh-CN.md)   | Archify、Diagram Design 与 Fireworks |
| [应用图标](icons.zh-CN.md)                | 图标浏览器、共享来源与 SVG           |

## 保存与服务

| 文档                                                 | 内容                              |
| ---------------------------------------------------- | --------------------------------- |
| [内容库](versioned-library.zh-CN.md)                 | SQLite 当前内容、草稿、恢复与维护 |
| [ShowAI Cloud](cloud.zh-CN.md)                       | 账号、服务绑定与模型来源          |
| [项目服务器与同步](project-sync.zh-CN.md)            | 自部署、权限、传输与冲突          |
| [服务器运维](server-operations.zh-CN.md)             | 一致备份、恢复、迁移与预算        |
| [Cloudflare MCP 部署](cloud-mcp-deployment.zh-CN.md) | 网关、共享指南与部署检查          |

## 集成与开发

| 文档                                        | 内容                          |
| ------------------------------------------- | ----------------------------- |
| [Agent 接入](agent-integration.zh-CN.md)    | stdio/HTTP、OAuth、工具与展示 |
| [CLI 脚本参考](agent-usage.zh-CN.md)        | 脚本、诊断、服务配置与运维    |
| [页面数据格式 v3](artifact-format.zh-CN.md) | 节点、几何、组件、导出与限制  |
| [品牌资源](branding.zh-CN.md)               | 标识来源、变体与生成          |

[插件说明](../../plugins/showai/README.zh-CN.md)介绍各个 Skill 与从源码安装。[贡献指南](CONTRIBUTING.zh-CN.md) 说明隔离开发与相关检查，参与项目须遵循[行为准则](CODE_OF_CONDUCT.zh-CN.md)。

## 运行时提供的参考

源码构建后，在仓库查询当前指南与能力：

```sh
node dist-runtime/scripts/cli.mjs guide --json
node dist-runtime/scripts/cli.mjs runtime info --json
```

已安装软件使用设置或目标库 agent-runtime.json 中的真实命令。Agent 文档操作使用 MCP；ChatGPT 托管连接通过 guide 获取共享流程，无需本机 Skill 安装。

可通过 [GitHub Issues](https://github.com/Renaissance-Mind/ShowAI/issues) 报告文档问题，注明语言、指南与运行时版本。贡献修改时同步中英文对应指南及两个目录。

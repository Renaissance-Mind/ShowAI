# ShowAI 文档

ShowAI 用**可阅读、可交互、可编辑**的页面承载人与 Agent 的共同创作。下面的文档覆盖工作台使用、Agent 接入、组件与模板、数据保存和开发接口。

**首次使用**建议先阅读[快速上手](quick-start.md)，完成启动、创建页面和导出；准备和 Codex 一起创作时，继续阅读 [Codex 使用指南](codex.md)。

## 开始使用

| 文档 | 内容 |
| --- | --- |
| [快速上手](quick-start.md) | 启动 ShowAI、创建项目与页面、保存和分享 |
| [Codex 使用指南](codex.md) | 安装插件、连接内容库、创建与续改页面、对话预览 |
| [本地浏览器版](local-browser.md) | 各平台启动器、内容目录和本地文件操作 |
| [Page 与 Board](page-surface.md) | 顺序页面、空间白板、嵌套容器和阅读交互 |
| [内置 Agent](agent-host.md) | 执行方式、模型来源、项目绑定与任务工作区 |

## 组织内容与复用

| 文档 | 内容 |
| --- | --- |
| [数据图表](g2-components.md) | G2 图表类型、数据接口、参数和交互 |
| [思维导图](mindmap.md) | 布局、节点编辑、快捷键和交互式导出 |
| [组件与模板](catalog-lifecycle.md) | 目录查找、项目资源、版本、依赖和复用 |
| [Skills 工作流程](skills.md) | 页面、组件与模板任务的处理方式 |
| [图标](icons.md) | 内置图标、SVG 图标与图标集 |

## 保存、历史与协作

| 文档 | 内容 |
| --- | --- |
| [内容库与历史](versioned-library.md) | 存储结构、版本比较、合并、恢复和备份 |
| [项目服务器与同步](project-sync.md) | 自部署服务、账号、项目权限和同步 |
| [ShowAI Cloud](cloud.md) | 云端连接、离线工作、存储配额与访问范围 |
| [服务器运维](server-operations.md) | 备份、恢复、上传维护与回滚 |

## Agent 与开发接口

| 文档 | 内容 |
| --- | --- |
| [Agent 接入](agent-integration.md) | 本机与远程 MCP、授权、同步和宿主展示 |
| [CLI 脚本参考](agent-usage.md) | 脚本、服务配置、诊断和运维命令 |
| [插件说明](../plugins/showai/README.md) | ShowAI 插件的安装、职责和运行时依赖 |
| [页面数据格式](artifact-format.md) | 页面、节点、布局与数据约定 |
| [品牌资源](branding.md) | ShowAI 标识、配色和视觉资源 |

CLI 的操作指南由正在使用的运行时提供。完成源码构建后，可以在仓库目录查询指南目录：

```sh
node dist-runtime/scripts/cli.mjs guide --json
```

插件连接到桌面应用或独立发行包时，应使用该软件提供的实际启动配置。**软件版本、内容库与所需能力**以 `runtime info --json` 的返回值为准。

## 反馈与贡献

文档正文保存在此目录的 Markdown 文件中。发现问题时，可以通过 [GitHub Issues](https://github.com/Renaissance-Mind/ShowAI/issues) 提交运行环境、软件版本、复现步骤和实际结果，也可以通过 Pull Request 改进文档。

项目概览、源码运行和贡献检查命令见[仓库首页](../README.md)。

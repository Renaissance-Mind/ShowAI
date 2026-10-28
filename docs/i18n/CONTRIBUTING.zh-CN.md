# 参与 ShowAI 开发

**语言：** [English](../../CONTRIBUTING.md) | 简体中文

ShowAI 接受内置组件、内置模板、功能与修复、文档，以及 Agent 插件和 Skill 的改动。本文说明每类改动放在哪里、需要同步更新什么、如何验证。产品和集成指南见[文档索引](index.zh-CN.md)。

新增内置组件或模板，或者新增入口、改变数据格式的功能，请先提交[功能请求](https://github.com/Renaissance-Mind/ShowAI/issues/new/choose)，在动手前商定范围。

## 准备环境

需要 Node.js 22.12 或更高版本、npm 和 Git。浏览器相关测试需要先运行 `npx playwright install chromium` 安装 Chromium。测试 Agent 插件还需要 [Codex](https://github.com/openai/codex) 或 Claude Code。

```sh
git clone https://github.com/Renaissance-Mind/ShowAI.git
cd ShowAI
npm ci
npm run dev:open
```

这会在 5173 端口启动带热更新的桌面开发实例，内容库为 `.showai-dev/library`。[开发与测试](development.zh-CN.md)说明如何隔离并行实例、如何读 `npm run dev:status`，以及各测试套件的前提条件。

## 确定改动类型

| 改动                          | 指南                                             |
| ----------------------------- | ------------------------------------------------ |
| 内置组件                      | [贡献内置组件](contributing-components.zh-CN.md) |
| 内置模板或系统呈现规则        | [贡献内置模板](contributing-templates.zh-CN.md)  |
| 应用功能或修复                | [功能与修复](#功能与修复)                        |
| 文档                          | [文档](#文档)                                    |
| Agent 插件、Skill 或 CLI 协议 | [Agent 插件与 Skill](#agent-插件与-skill)        |

只服务一个主题或一位用户的组件和模板，通常应保存在内容库里，不进入本仓库。两份指南分别说明什么情况下适合做成内置。

## 每个拉取请求都要运行的检查

```sh
npm run check   # TypeScript 与组件 SDK 边界
npm run build   # 完整构建；CLI 和 MCP 集成测试使用构建产物
npm test        # Vitest 单元与集成测试
```

各类改动另有检查项，列在对应指南或章节中。持续集成在 Linux 和 Windows 上运行相同的命令。

## 功能与修复

先扩展已有能力，再考虑新增。对象上的新操作放进该对象已有的选中、右键或悬停菜单，通用操作在前，对象专属操作在后；只有现有入口都无法承载时才新增工具栏、齿轮按钮或浮动控件，并在拉取请求中说明原因。同一操作从不同菜单进入时，共用一个命令和一个状态来源。

所有界面文字放进 `src/i18n/messages/` 下的消息命名空间，同时提供 `zh-CN` 和 `en`。`src/i18n/i18n.test.ts` 会拒绝写死的中文、缺失的键和不一致的占位符；`src/i18n/glossary.ts` 统一页面、白板、内容块等核心术语的译名。

已保存的页面、内容库和导出页面的寿命比写入它们的代码更长。修改数据格式、CLI 命令或 MCP 工具时，必须继续读取旧版本写入的内容；检查现有调用方，并在拉取请求中说明兼容方式。在程序的输入边界（I/O、进程、用户输入）处理错误并暴露原因，不要吞掉失败后报告成功。

按改动范围运行相关测试：

| 范围                 | 命令                                                         |
| -------------------- | ------------------------------------------------------------ |
| 桌面行为（Electron） | `npm run test:desktop`                                       |
| Page 与 Board 交互   | `npm run test:containers`、`npm run test:containers:desktop` |
| 组件浏览器           | `npm run test:component-gallery`                             |
| 开发启动器与热更新   | `npm run test:dev`、`npm run test:dev -- desktop`            |
| 浏览器版服务         | `npm run test:browser`                                       |
| 同步服务             | `npm run test:server`                                        |
| HTTP MCP 网关        | `npm run test:cloud-mcp`                                     |

新增测试使用真实的临时内容库和真实的组件编译，不使用 mock。界面改动还要在开发实例中实际检查：浏览器通过不代表桌面通过，涉及 Electron 的改动需要在桌面实例中验证。屏幕上有变化的部分，检查窄窗口、深色主题、键盘操作和阅读视图。

## 文档

Markdown 文件默认被忽略。新增公开 `.md` 文件需要把准确路径加入 `.gitignore` 的允许列表，否则 Git 会悄悄漏掉它。每份英文指南都有简体中文版本：`README.md` ↔ `docs/i18n/README.zh-CN.md`，`CONTRIBUTING.md` ↔ `docs/i18n/CONTRIBUTING.zh-CN.md`，`docs/TOPIC.md` ↔ `docs/i18n/TOPIC.zh-CN.md`。两种语言一起修改，新指南同时加入两个索引（`docs/README.md` 与 `docs/i18n/index.zh-CN.md`），并保持语言切换和相对链接有效。

README、快速开始、横幅、应用欢迎文案和主页共用一套标语、一句话介绍和示例提示词，定义在 `scripts/release-entry.mjs`。修改后运行 `npm run release:check`。应用内置文档 `resources/docs` 是 showai.renaissancemind.ai/doc 页面的副本；请修改网站文档后运行 `npm run docs:sync -- --site <website>/site`，不要直接编辑副本。

文档中的每条命令都要对照实现它的代码核实，并写明描述的是哪个版本：源码、已安装的应用或插件、已部署的服务，还是已发布的版本。内部计划、凭据、本机路径、测试日志和验收证据不放进公开文档。

## Agent 插件与 Skill

插件源码位于 `plugins/showai/`，包括 Skill、宿主适配说明和 MCP 启动器。`npm run package:plugin`（`npm run build` 也会执行）检查每个 Skill 的 frontmatter 和相对链接，然后重新生成宿主包 `plugins/showai-codex`、`plugins/showai-claude` 和 `plugins-kimi/showai`。只编辑 `plugins/showai/`，并把重新生成的副本一起提交。新增或删除 Skill 文件后，还要运行 `node scripts/mcp-skill-source.mjs`，让托管 MCP 网关提供同样的文件。

Skill 的 `description` 决定 Agent 何时加载它，正文由一个没有其他上下文的 Agent 阅读。修改其中任一部分后，在新的 Agent 会话中提供已安装的 Skill 和几个真实请求，检查它会选择哪个 Skill，以及只凭文字能否判断下一步该做什么。在拉取请求中写明这些请求和结果。

修改 CLI 命令、参数或输出，或者修改 MCP 工具时，在同一个拉取请求中更新描述它的 Skill、`src/agent/guides.ts` 和文档（通常是 `docs/agent-usage.md` 或 `docs/agent-integration.md` 及其中文版）。`src/agent/doc-examples.test.ts` 会用当前工具 schema 检查 Skill 和指南中引用的工具调用。Agent 会沿用学过的调用方式，因此 MCP 工具的名称或参数变化时，在 `src/agent/tool-changes.ts` 中记录变化，并在 `src/agent/mcp-compat.ts` 中转换旧的调用方式。

本地试用插件时，`npm run plugin:update -- --json` 把打包好的插件安装到 Codex 并核验安装文件，`npm run plugin:claude -- --port <port> --json` 把本 checkout 中的 Claude Code 绑定到一个运行中的开发实例。安装文件和宿主加载是两个独立环节：请在新对话中确认新的 Skill 和工具已经出现。

## 与 AI Agent 协作

仓库在 `.claude/skills/` 和 `.agents/skills/` 中提供 `showai-contributing` Skill。Claude Code 和 Codex 在本 checkout 中工作时会自动加载它，按同样的指南和检查项引导 Agent 完成改动。

## 拉取请求

- 每个拉取请求只做一件事。说明改了什么、为什么改，以及验证了什么：命令、桌面或浏览器、平台，以及相关指南要求的人工检查。
- 提交信息使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式，例如 `feat(editor): ...`、`fix(sync): ...`、`docs: ...`。
- 按改动类型填写拉取请求模板中的检查清单。

## 反馈问题

请使用 [GitHub Issues](https://github.com/Renaissance-Mind/ShowAI/issues)。报告缺陷时写明平台、ShowAI 版本或提交、使用的是桌面版还是浏览器工作台、复现步骤，以及预期和实际结果。

## 行为准则

参与本项目须遵守[行为准则](CODE_OF_CONDUCT.zh-CN.md)。

## 许可证

提交贡献即表示你同意以 [MIT 许可证](../../LICENSE) 授权你的贡献。

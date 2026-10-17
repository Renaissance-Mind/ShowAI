![ShowAI — 构建人与 Agent 之间的 Interface。](showai-banner.zh-CN.svg)

<p align="center">
  <a href="https://showai.renaissancemind.ai/"><img src="https://img.shields.io/badge/Website-ShowAI-2563EB?style=flat&amp;labelColor=30343B" alt="ShowAI 官网"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-MIT-22A06B?style=flat&amp;labelColor=30343B" alt="MIT 许可证"></a>
  <a href="#cli-与-mcp"><img src="https://img.shields.io/badge/MCP-compatible-0891B2?style=flat&amp;labelColor=30343B" alt="兼容 MCP"></a>
  <a href="#网页版-chatgpt"><img src="https://img.shields.io/badge/ChatGPT-Web-10A37F?style=flat&amp;labelColor=30343B" alt="ChatGPT 网页版接入"></a>
  <a href="codex.zh-CN.md"><img src="https://img.shields.io/badge/Codex-Plugin-6366F1?style=flat&amp;labelColor=30343B" alt="Codex 插件"></a>
  <a href="../../plugins/showai/README.zh-CN.md"><img src="https://img.shields.io/badge/Claude_Code-Plugin-E48149?style=flat&amp;labelColor=30343B" alt="Claude Code 插件"></a>
</p>

**语言:** [English](../../README.md) | 简体中文

[文档](index.zh-CN.md) · [快速开始](quick-start.zh-CN.md) · [在 Codex 中使用](codex.zh-CN.md)

**Agent-Native、Human-Friendly 的人机协作 Harness。**

Agent 能分析市场、规划项目、讲解系统，但回答往往只是一段文字，你能做的只有继续回复。ShowAI 让 Agent 的回答从文本走向可交互、可编辑、可协作的 presentation，由你和 Agent 一起持续完善，并且在对话结束之后仍然可用。

https://github.com/user-attachments/assets/375d6ff3-fe3e-47c2-b6a4-d69df1b86b20

<sub>在任意 Agent 对话里提问，得到一个能用、能一起改、能分享的界面。示例可在 [showai.renaissancemind.ai](https://showai.renaissancemind.ai/) 体验。</sub>

![对 Agent: 获得一个面向人的表达与协作界面，把信息和分析转化为人可以理解、操作与反馈的内容。 — 对人: 获得一个参与 AI 工作的认知界面，通过阅读、探索和修改，把自己的理解与判断带入共同创作。](showai-audience.zh-CN.svg)

### ✨ Features

- **Intelligent UI**：Agent 的回答直接生成为由区块、图表、画布和组件构成的可交互页面，而不是一段 Markdown；支持 Codex、Claude Code、Kimi、Gemini CLI、OpenCode、DSH 等多种 Agent 宿主。
- **Evolving Presentation**：组件、模板和呈现方法都是显式且版本化的，Agent 缺什么表达就补什么组件，做得好的作品可提炼为模板，每一轮都在为下一轮积累。
- **Human-Agent Brainstorming**：在同一块画布上边写边画边问，选中任意文字、单元格或画布对象就能让 Agent 展开、重组或可视化，多个对话可以并行推进同一个项目。
- **Living Archive**：产出默认就是本地项目里的版本化文件，与源码目录自动绑定，带完整历史和冲突保护，随时可以续改、复用或拆成新素材。
- **Cross-device**：iPad 与 Mac 配对后共用同一份内容，Agent 任务可以在本机、云端或配对的 Mac 上执行。
- **Local-first, share when you want**：不开账号也能完整使用，需要时接自建服务器多人协作，或导出一个离线可交互的 HTML。

> **版本：** 本文档对应 main 分支的应用 **0.9.0**、插件 **0.16.1** 和页面格式 **v3**。软件、插件与托管服务独立更新；可下载文件以 [Releases](https://github.com/Renaissance-Mind/ShowAI/releases) 为准。全部公开使用与技术指南提供中英文版本，见[文档目录](index.zh-CN.md)。

工作台支持英文和简体中文，在「设置 → 外观 → 语言」切换；导出阅读器使用导出时的界面语言。

## 🧩 设计逻辑

![ShowAI 设计逻辑：从可由 Agent 动态添加的组件、内容（模板），到 Agent 上下文与 ShowAI App 中的共创，以及使用与交付](showai-design-logic.zh-CN.svg)

1. **组件：按需要表达信息。** 文本、图片、表格、图表、流程图和滑块提供不同的表达与交互方式。Agent 可以选择已有组件，也可以根据任务创建并加入新组件，例如让读者调整参数、观察计算结果的控件。

2. **内容（模板）：组织内容，复用结构。** 组件组合成可阅读、可操作的内容。[Page](page-surface.zh-CN.md) 按顺序组织文章与报告，Board 用空间布局组织关系与方案。常用的内容结构和组件组合可以保存为模板：应用模板填入新材料，或从完成的内容中提炼模板，供后续创作复用。详见[组件与模板说明](catalog-lifecycle.zh-CN.md)。

3. **共同创作：在聊天与 App 中参与。** 在支持页面展示的 Agent 会话中，内容直接呈现在聊天里。人可以查看图表、操作控件，再通过后续对话让 Agent 继续分析和修改。

   ShowAI App 提供类似笔记软件的工作台，用于管理项目与页面、直接编辑内容和复用组件。讨论可以在 Agent 上下文中展开，内容也可以在 App 中持续整理和完善。

4. **使用与交付：让内容被使用和分享。** 独立 HTML 保留页面的阅读与交互，读者无需安装 ShowAI；静态 Site 组织多页内容，适合通过网址分享。局部导出可以只分享某个组件或区域，源 JSON 则用于导入并继续编辑，让成果能够持续使用。

## 💡 使用场景

- **调研与分析**：组织问题、来源、证据和比较结果，在同一页中形成判断。
- **教学与讲解**：结合流程图、折叠内容和参数实验，帮助读者逐步理解。
- **数据探索**：把图表、原始数据和分析文字放在一起，方便查看与核对。
- **方案共创**：在人与 Agent 之间持续修改方案，将反馈纳入共享页面。
- **知识分享**：将共同形成的内容整理为页面或 site，供他人阅读和探索。

## 🚀 开始使用

从源码运行需要 **Node.js 22.12+** 和 npm。

### 本地浏览器工作台

```sh
git clone https://github.com/Renaissance-Mind/ShowAI.git
cd ShowAI
npm ci
npm run build:browser
npm run browser
```

启动后，浏览器会打开本机工作台。使用期间保持终端运行，按 `Ctrl+C` 停止服务。

### 桌面工作台

在仓库目录中安装依赖后，构建并启动 Electron 应用：

```sh
npm run build
npm run desktop
```

### 创建第一份内容

1. 新建项目，再创建一个 Page 或 Board。
2. 输入 `/`，插入需要的组件；也可以选择已有模板。
3. 编辑内容，或让连接的 Agent 一起创作。
4. 完成后导出 HTML 或静态网站。

默认内容库为 `~/.showai`，可在设置中更改。桌面应用、浏览器工作台与 CLI 指向同一内容库时，共同读写其中的项目。

本地浏览器版支持 macOS、Linux 和 Windows，也可以打包为自带 Node 运行时的发行包。启动器与平台要求见[本地浏览器版说明](local-browser.zh-CN.md)。

## 🤖 连接 Agent

ShowAI 通过官方 MCP 接入网页版 ChatGPT，也提供 Codex 与 Claude Code 本机插件。连接后可以直接提出创作需求：

> 在当前项目中做一份模型调研报告，把来源、对比表和结论组织在同一页。

> 修改这份讲解，加入可以调整参数的交互模型，让读者观察参数变化的影响。

> 把这页整理成可复用模板，并生成一个应用示例。

### 网页版 ChatGPT

在 [ChatGPT Plugins](https://chatgpt.com/plugins) 添加自定义 MCP 连接，认证选择 **OAuth or no authentication**：

```text
https://agent.showai.renaissancemind.ai/mcp
```

使用 ShowAI Cloud 账号并授权所需项目。新建项目需要账号范围与 projects.create 权限。账号/同步基址是 `https://showai.renaissancemind.ai/cloud`，注册需要运营者密钥或有效项目邀请。日常网页使用无需本机 ShowAI 进程或单独安装 Skill。

参见[完整 ChatGPT 网页指南](chatgpt.zh-CN.md)，了解注册、第三方登录完成码、权限、连接刷新与排查。每个人独立添加并授权连接。

### 安装本机插件

**Codex**：需要先安装 [Codex CLI](https://github.com/openai/codex) 并确保其在 `PATH` 中。在仓库目录中执行：

```sh
npm run plugin:install
```

拉取新代码后，用 `npm run plugin:update` 刷新已安装的插件。请先启动一次 ShowAI 应用（或执行下文的 `npm run runtime:register`），插件才能在内容库中找到运行时。

**Claude Code**：在仓库目录中执行：

```sh
claude plugin marketplace add ./
claude plugin install showai@renaissance-mind
```

安装后通过宿主支持的方式刷新能力，再在新会话确认工具与 Skill 可见。插件包含八个 Skill：

| Skill                 | 用途                                     |
| --------------------- | ---------------------------------------- |
| `use-showai`          | 基础用法、连接运行时、查找和阅读内容     |
| `plan-presentation`   | 明确认知起点、证据范围与多级理解路径     |
| `design-presentation` | 设计视觉表达、布局、交互分镜与静态方式   |
| `review-presentation` | 检查读者任务、定位问题并按授权修订       |
| `show-document`       | 创建、修改、展示和导出页面，应用已有模板 |
| `create-component`    | 创建或改造可复用的 React 组件            |
| `create-template`     | 创建、修改模板，或从已有页面提炼模板     |
| `collaborate-canvas` | 设备配对、边写边画、多对话与可选位置参考 |

插件提供创作流程与参考说明，运行程序由 ShowAI 应用或独立运行包提供。桌面用户可在「设置 → 连接 Agent」中取得启动配置；从源码构建的独立运行包可执行：

```sh
npm run runtime:register
```

安装与接入步骤见[插件说明](../../plugins/showai/README.zh-CN.md)。

### CLI 与 MCP

CLI 每次执行一个命令后退出，可以在工作台关闭时使用。完成构建后，在仓库目录中执行：

```sh
# 查看已有项目
node dist-runtime/scripts/cli.mjs projects list --json

# 查询可用组件
node dist-runtime/scripts/cli.mjs catalog list \
  --kind component --query 图表 --limit 5 --json

# 查看页面创作指南
node dist-runtime/scripts/cli.mjs guide authoring --json
```

其他 Agent 客户端也可以通过可选的 stdio MCP 入口接入。完整命令、编辑协议与配置见 [Agent 使用说明](agent-usage.zh-CN.md)。

## 📦 分享页面与 Site

| 导出格式        | 适用场景                            |
| --------------- | ----------------------------------- |
| **独立 HTML**   | 分享、离线阅读和归档                |
| **inline 片段** | 在支持 HTML 展示的 Agent 对话中呈现 |
| **静态网站**    | 多页面导航与静态托管                |

独立 HTML 支持图表切换、折叠内容和本地参数计算等离线交互；外部来源链接需要联网。离线导出要求图片已内嵌。

将下方的 `PROJECT_ID` 和 `PAGE_ID` 替换为实际 ID，即可导出页面：

```sh
node dist-runtime/scripts/cli.mjs export \
  --project PROJECT_ID \
  --page PAGE_ID \
  --format html \
  --out ./report.html \
  --json
```

导出整个项目的静态网站：

```sh
node dist-runtime/scripts/cli.mjs export \
  --project PROJECT_ID \
  --format site \
  --out ./site \
  --json
```

使用 `--blocks ID,ID` 可以导出选定的组件或区域。HTML 与 inline 导出同时保存 `.showai.json` 源文件，便于重新导入和继续编辑。

静态网站目录可部署到自己的服务器或托管服务。导出格式与选项见 [Agent 使用说明](agent-usage.zh-CN.md)。

## 🔒 内容与同步

项目内容保存在本机的 SQLite 内容库，支持备份与迁移。保存更新当前内容，通过页面 hash 和资源 token 检查并发修改；本地草稿与冲突恢复保留未完成的工作。

跨设备或与他人协作时，连接 ShowAI Cloud 或自部署的 ShowAI Server，按项目同步当前页面、组件依赖和资源。管理员、编辑者与查看者角色管理访问权限。HTML 预览与导出按需生成。

[内容库](versioned-library.zh-CN.md) · [项目服务器与同步](project-sync.zh-CN.md)。

## 📚 文档

全部使用与技术指南均有中英文版本及语言切换。浏览[中文文档目录](index.zh-CN.md)或 [English index](../README.md)。

| 开始使用                               | 创作与集成                                  | 保存与分享                                |
| -------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| [快速上手](quick-start.zh-CN.md)       | [组件与模板](catalog-lifecycle.zh-CN.md)    | [内容库](versioned-library.zh-CN.md)      |
| [网页版 ChatGPT](chatgpt.zh-CN.md)     | [模板文件夹](template-bundles.zh-CN.md)     | [Cloud 与账号](cloud.zh-CN.md)            |
| [Codex 插件](codex.zh-CN.md)           | [组件参数](component-parameters.zh-CN.md)   | [项目同步](project-sync.zh-CN.md)         |
| [Page 与 Board](page-surface.zh-CN.md) | [Agent 接入](agent-integration.zh-CN.md)    | [服务器运维](server-operations.zh-CN.md)  |
| [内置 Agent](agent-host.zh-CN.md)      | [页面数据格式 v3](artifact-format.zh-CN.md) | [MCP 部署](cloud-mcp-deployment.zh-CN.md) |

## 🛠️ 开发与贡献

ShowAI 使用 React、TypeScript、Electron 与 Vite。富文本编辑基于 Tiptap，流程图基于 React Flow，数据可视化使用 G2。

启动支持热更新的完整桌面工作台：

```sh
npm run dev:open
```

查看当前开发服务：

```sh
npm run dev:status
```

浏览器开发版使用 `npm run dev:browser`。默认开发内容库位于 `.showai-dev/library`，可以通过启动参数指定其他目录。隔离的开发实例、端口与测试说明见 [贡献指南](CONTRIBUTING.zh-CN.md)。

提交改动前执行：

```sh
npx playwright install chromium
npm run check
npm test
npm run build
```

浏览器测试需要先安装一次 Chromium。Windows 的目录链接测试使用 junction；缺少开发者模式或符号链接权限时，文件符号链接测试会明确标记为跳过，其余路径与完整性检查仍会执行。

涉及桌面行为时，可运行 `npm run test:desktop`；涉及 Page 与 Board 交互时，可运行 `npm run test:containers` 和 `npm run test:containers:desktop`。

欢迎通过 [Issues](https://github.com/Renaissance-Mind/ShowAI/issues) 反馈问题、提出使用场景，或通过 Pull Request 贡献代码、组件、模板与文档。问题反馈请附上运行环境、复现步骤，以及预期与实际结果。

## 许可证

ShowAI 使用 [MIT 许可证](../../LICENSE)。

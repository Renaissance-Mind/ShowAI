# 快速上手

**语言：** [English](../quick-start.md) | 简体中文 · [文档目录](index.zh-CN.md)

ShowAI 是可进化的人机交互界面：Agent 的回答不再只是一段文字，而是一个可以交互、可以归档、在使用中不断进化的界面。

ShowAI 在你已经在用的 Agent 里工作：装上插件后，Agent 就能把回答做成界面；ShowAI App 负责保存、打开和继续编辑这些界面。本指南从下载开始，带你做出第一个界面，再继续修改和分享它。

## 开始前

- 一台 Apple Silicon Mac，系统为 macOS 13 或更高版本。
- 已安装并登录 **Claude Code** 或 **Codex**。ShowAI 通过 Agent 的命令行工具安装插件，需要该工具可用；Codex 也可以使用 Codex App 自带的命令行工具，ShowAI 会自动查找。
- 还没有 Agent？可以在 App 中填写模型 API Key，使用[内置 Agent](#不使用-claude-code-或-codex)。
- Windows 或 Linux 用户[从源码运行浏览器版](#从源码运行)。

## 1. 安装 ShowAI

1. 从[最新发行版](https://github.com/Renaissance-Mind/ShowAI/releases/latest)下载 DMG。
2. 打开 DMG，把 **ShowAI** 拖进「应用程序」，然后打开 ShowAI。
3. 当前版本尚未经过 Apple 公证，macOS 可能阻止首次打开。遇到时打开「系统设置 → 隐私与安全性」，选择「仍要打开」（参见 [Apple 的说明](https://support.apple.com/zh-cn/102445)）。每个版本的发行说明会写明是否仍需这一步。

## 2. 连接你的 Agent

> **注意：** 目前可下载的 v0.9.0 还没有欢迎页和「设置 → 插件」，两者将随下一个版本发布。在此之前，请[从源码运行](#从源码运行)，并从仓库安装插件。

1. 在 ShowAI 中打开插件面板：首次启动时欢迎页会显示它，之后随时可以在「设置 → 插件」中找到。
2. ShowAI 会检测 Claude Code 与 Codex。在你使用的 Agent 旁点「安装插件」，等待显示「已安装并启用」。
3. 重新加载 Agent：Claude Code 重启会话；Codex 刷新插件或重启 Codex。已经打开的对话仍使用旧的工具列表，请新开一个对话。

要确认连接，「设置 → 插件」会给出测试提示词「用 ShowAI 列出我的项目」。在新对话中发送它；Agent 连上 ShowAI 后，该 Agent 旁的状态会从「等待第一次调用」变为「已收到第一次调用」。

插件和它连接的运行时都由 App 提供，不需要源码，也不需要另外安装 Node.js。插件连接 App 当前的内容库；切换内容库或移动 App 后，点「更新并启用」。

## 3. 让 Agent 做第一个界面

在新对话中粘贴：

> 用 ShowAI 帮我做一个房贷计算器：房价、首付比例、利率和贷款年限可以调整，显示月供和总利息。

Agent 会把界面保存为 ShowAI 中的一个页面并展示出来：支持内嵌显示的 Agent 直接在对话里显示，其他 Agent 给出可以打开的 HTML 文件。在 App 中，它出现在「最近」里。

再试两个：

> 用 ShowAI 比较两台折叠屏手机：按便携、续航、影像和价格列出差异，并让我调整各项权重。

> 用 ShowAI 一步步讲清注意力机制，配一个可以调整参数、观察权重变化的示意。

## Agent 找不到 ShowAI 时

| 看到的情况                          | 处理方法                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 插件面板提示未找到宿主              | 安装 Claude Code 或 Codex，确认其命令行工具能在终端中运行（`claude --version` 或 `codex --version`），再点「重新检测」。 |
| 显示「已安装，尚未启用」            | 点「更新并启用」。                                                                                                       |
| 提示已启用其他来源的 ShowAI 插件    | 先在 Agent 中停用原插件，再点「重新检测」并安装 App 版本。                                                               |
| Agent 只用文字回答，没有提到 ShowAI | 对话在插件加载前就已开始。重启 Agent 并新开对话；提示词以“用 ShowAI……”开头会更明确。                                     |
| Agent 报告无法连接 ShowAI           | 如果移动过 App 或切换过内容库，在「设置 → 插件」中点「更新并启用」，然后重启 Agent。                                     |
| 页面已保存，但在 App 中找不到       | App 与插件使用了不同的内容库。对照「设置 → 通用 → 内容库」与「设置 → 插件」中显示的内容库。                              |

仍未解决时，请[提交 Issue](https://github.com/Renaissance-Mind/ShowAI/issues)，写明 Agent 及其版本、「设置 → 关于」中的 ShowAI 版本，以及 Agent 的回复。

## 4. 继续修改

这个界面是属于你的页面。从「最近」打开它就可以直接编辑：输入文字，或输入 `/` 插入表格、图表、图片等组件。保存状态显示「已保存」时，修改已经存储。

然后让 Agent 接着做：

> 加一张按年份显示剩余本金的图表。保留我改过的数值。

Agent 修改前会先读取当前页面，包括你的修改。你和 Agent 同时修改同一页面时，后保存的一方会被暂停，两份内容都保留下来供比较，不会互相覆盖。

现有组件表达不了需要的内容时，Agent 可以为它写一个新组件；好用的页面可以沉淀为模板，作为下一次的起点。详见[组件与模板](catalog-lifecycle.zh-CN.md)。

## 5. 分享

| 交付方式    | 用途                                              |
| ----------- | ------------------------------------------------- |
| 独立 HTML   | 发送单页、离线阅读或归档                          |
| inline 片段 | 在支持 HTML 展示的 Agent 对话中预览整页或选定部分 |
| 静态网站    | 把多页内容组织成带导航的网站                      |
| ShowAI JSON | 重新导入并继续编辑                                |

在页面菜单中选择「导出页面」，或让 Agent 导出。独立 HTML 无需安装 ShowAI 就能在浏览器中打开，图表、折叠区域和本地计算等交互仍然可用。外部链接需要网络；需要完全离线阅读时，把图片内嵌到页面。HTML 导出会同时保存 `.showai.json` 源文件，便于以后导入继续编辑。

## 不使用 Claude Code 或 Codex

**内置 Agent。** 打开「设置 → Agent」，添加使用 API Key 的模型来源（也可以使用本机 Codex 或 Claude Code 的登录，或 ShowAI Cloud），然后点顶栏的 AI 按钮，或选中文字、打开内容块菜单，选择「让 AI 处理」。详见[内置 Agent](agent-host.zh-CN.md)。

**其他 Agent。** DeepSeek Harness 与 Kimi 处于预览阶段，网页版 ChatGPT 采用邀请制，其他 MCP 客户端可以手动配置。详见[支持的 Agent](README.zh-CN.md#-支持的-agent)。

**单独使用。** 工作台不连接 Agent 也能使用：点「新建项目」，添加按阅读顺序排版的 **Page** 或可以自由摆放内容的 **Board**，输入 `/` 插入组件。详见 [Page 与 Board](page-surface.zh-CN.md)。

## 从源码运行

浏览器版支持 macOS、Linux 和 Windows，需要 Git、**Node.js 22.12 或更高版本**以及 npm。

```sh
git clone https://github.com/Renaissance-Mind/ShowAI.git
cd ShowAI
npm ci
npm run build:browser
npm run browser
```

**使用期间保持终端运行**。浏览器没有自动打开时，复制终端显示的地址；结束后按 `Ctrl+C` 停止。改为构建并启动桌面 App：

```sh
npm run build
npm run desktop
```

源码版连接 Agent 时，按[插件说明](../../plugins/showai/README.zh-CN.md)从仓库安装插件。启动器与打包见[本地浏览器版](local-browser.zh-CN.md)。

## 内容保存在哪里

页面保存在本机内容库中，默认是 `~/.showai`。可以在「设置 → 通用 → 内容库」中选择其他位置。App、插件和 CLI 使用**相同内容库**时，才能看到同一批项目。

ShowAI 自动保存，并保留草稿与冲突副本，未完成的修改不会丢失。出现保存失败提示时，先处理再关闭页面。详见[内容库](versioned-library.zh-CN.md)。需要跨设备或多人协作时，连接 [ShowAI Cloud](cloud.zh-CN.md) 或[自部署服务器](project-sync.zh-CN.md)。

继续浏览[文档目录](index.zh-CN.md)。

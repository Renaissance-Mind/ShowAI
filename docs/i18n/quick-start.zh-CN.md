# 快速上手

**语言：** [English](../quick-start.md) | 简体中文 · [文档目录](index.zh-CN.md)

ShowAI 是可进化的人机交互界面：Agent 的回答不再只是一段文字，而是一个可以交互、可以归档、在使用中不断进化的界面。

ShowAI 在你已经在用的 Agent 里工作：装上插件后，Agent 就能把回答做成界面；ShowAI App 负责保存、打开和继续编辑这些界面。本指南从下载开始，带你做出第一个界面，再继续修改和分享它。

## 开始前

- 一台 Apple Silicon Mac，系统为 macOS 13 或更高版本。
- 安装要连接的宿主，并按它的要求登录。各宿主的安装方式与功能见[支持清单](README.zh-CN.md#-支持的-agent)。
- 还没有 Agent？可以在 App 中填写模型 API Key，使用[内置 Agent](#不使用-claude-code-或-codex)。
- Windows 或 Linux 用户[从源码运行浏览器版](#从源码运行)。

## 1. 安装 ShowAI

1. 从[最新发行版](https://github.com/Renaissance-Mind/ShowAI/releases/latest)下载 DMG。
2. 打开 DMG，把 **ShowAI** 拖进「应用程序」，然后打开 ShowAI。
3. 当前版本尚未经过 Apple 公证，macOS 可能阻止首次打开。遇到时打开「系统设置 → 隐私与安全性」，选择「仍要打开」（参见 [Apple 的说明](https://support.apple.com/zh-cn/102445)）。每个版本的发行说明会写明是否仍需这一步。

ShowAI 会在后台检查新版本。打开「设置 → 关于与反馈」可以查看新版本，点击版本号旁的刷新图标可以重新检测。选择「安装并重启」后开始下载，准备就绪时右下角会出现提示。你可以点「立即重启」，等 20 秒自动重启，或点「稍后重启」继续工作。选择「下载并在下次启动时更新」，更新会在正常退出后、下次打开时生效。更新完成后，ShowAI 会提示同时更新 Agent 插件。

## 2. 连接你的 Agent

以下菜单按 `main` 说明。在[公开发行的 0.13.0](https://github.com/Renaissance-Mind/ShowAI/blob/v0.13.0/plugins/showai/README.zh-CN.md#deepseek-harness) 中，打开设置里的「外部 Agent 插件」栏目即可复制本机启动配置。该发行版接入 DeepSeek Harness 时，先点「准备插件」，再去 Harness 完成安装。当前源码构建可在「设置 → Agent 插件」直接安装。

1. 在 ShowAI 中打开插件面板：首次启动时欢迎页会显示它，之后随时可以在「设置 → Agent 插件」中找到。
2. 选择宿主，按该行提示直接安装、准备插件目录或导入安装包。
3. 按宿主提示刷新并新开会话。例如，Claude Code 重启会话，Codex 刷新插件或重启后新开对话。

在 Agent 中使用 ShowAI 后，打开「设置 → MCP → 调用记录」，即可看到工具名、客户端、结果和耗时。同一栏目也可以查看本机运行时、复制启动配置和设置记录保留时间。

插件和它连接的运行时都由 App 提供，不需要源码，也不需要另外安装 Node.js。插件连接 App 当前的内容库；切换内容库或移动 App 后，点「更新并启用」。

## 3. 让 Agent 做第一个界面

在新对话中粘贴：

> 用 ShowAI 做一个房贷计算器。让我调整房价、首付比例、利率和期限，显示月供和总利息，并保存为 ShowAI 页面。

示例明确要求保存计算器。保存后，从宿主返回的页面卡片、链接或 ShowAI 的「最近」打开原页。只想试一试时，可以先让 Agent 在聊天里展示，想保留时再指定项目并要求保存。

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
| Agent 报告无法连接 ShowAI           | 在「设置 → MCP」检查并修复本机运行时。如果宿主连接了另一个内容库，到「设置 → Agent 插件」点「修复并重新连接」或「更新并启用」。然后重启 Agent。 |
| 页面已保存，但在 App 中找不到       | App 与插件使用了不同的内容库。对照「设置 → 通用 → 内容库」与「设置 → Agent 插件」中该 Agent 的「插件连接的内容库」。              |

仍未解决时，请[提交 Issue](https://github.com/Renaissance-Mind/ShowAI/issues)，写明 Agent 及其版本、「设置 → 关于与反馈」中的 ShowAI 版本，以及 Agent 的回复。

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

**内置 Agent。** 打开「设置 → 内置 Agent」，添加使用 API Key 的模型来源（也可以使用本机 Codex 或 Claude Code 的登录，或 ShowAI Cloud），然后点顶栏的 AI 按钮，或选中文字、打开内容块菜单，选择「让 AI 处理」。详见[内置 Agent](agent-host.zh-CN.md)。

**其他 Agent。** DeepSeek Harness、Kimi Work、Kimi Code 和 TRAE IDE 各有专用安装步骤。网页版 ChatGPT 通过公网 HTTPS 和 OAuth 连接自己的桌面 App，也可以使用管理员提供的托管地址。详见[支持的 Agent](README.zh-CN.md#-支持的-agent)和 [ChatGPT 接入指南](chatgpt.zh-CN.md)。

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

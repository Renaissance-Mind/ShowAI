# ShowAI 内置 Agent

设置中的 Agent 页面提供两种执行方式。它们通过项目绑定的 MCP 复用 ShowAI 的项目工具，页面读写继续使用当前 hash 和 revision，并保留内容库现有的保存冲突处理。

| 方式         | 运行时                                                    | 凭据与能力                                                                          |
| ------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 本机 Agent   | 已安装的 Codex、Kimi、Claude Code、Gemini CLI 或 OpenCode | 复用该 Agent 的本机登录；探测程序与认证状态，真实调用测试单独记录                   |
| 提供 LLM API | 按需安装的官方 Codex TypeScript SDK 与对应平台运行时      | ShowAI 管理模型来源，运行时只安装 ShowAI 插件并使用独立 HOME、CODEX_HOME 和会话目录 |

本机 Codex 使用新的任务会话，不接管桌面上已有的对话。Kimi、Gemini 和 OpenCode 通过 ACP 连接；需要用户确认的 ACP 工具请求在任务记录中显示，允许一次或拒绝。Claude Code 使用其非交互接口。没有找到程序或调用失败时，界面显示实际原因，配置文件存在不代表调用已通过。

## 模型来源

预设包括 ChatGPT 套餐、OpenRouter、DeepSeek、OpenAI API、Moonshot 和自定义服务。Responses 来源直接转发 Responses 请求；Chat Completions 来源通过任务专属的本机网关转换输入、命名空间工具、工具结果和流式完成事件。具体模型仍需通过真实调用确认兼容性。

API Key 与 OAuth 凭据存放在应用专属目录，文件权限为仅当前用户可读写，设置响应只返回连接状态。模型供应商凭据由网关读取；Codex 子进程只取得本机网关的任务凭据。网关绑定 127.0.0.1，任务结束后关闭。ChatGPT 使用官方动态注册、PKCE、state、nonce 与 ID token 验证流程；只向官方 Responses API 使用这类授权。

SDK 和平台包从官方 npm 注册表获取，核对 SHA-512 完整性后解包，不执行安装脚本。安装不写入全局 npm、Python 或用户的 Codex 目录。ShowAI 插件通过独立 Codex 的官方插件命令安装，安装后检查插件与可见 Skill 清单。升级完成前保持旧安装记录；失败会显示具体原因。

## 执行位置与权限

桌面运行时和凭据位于 Electron userData 下的 agent-host 目录。任务工作区默认位于文档目录的 ShowAI/Agent Workspaces，按项目与任务分开。页面通过 ShowAI 工具写入原项目；工作区保存辅助材料与中间文件。会话记录保存在应用数据目录，可以继续 SDK 会话。

SDK 子进程使用独立环境，不继承用户的 API Key、Codex 登录令牌、宿主会话 ID、skills 或插件配置。ShowAI 的页面创建、保存、局部修改、组件与模板创作工具在项目绑定的连接中授权执行；其他工具保留自身的审批行为。命令执行使用 workspace-write 沙盒。

本机 Agent 模式保留其已有认证与运行配置。连接测试发送一条简短请求，不修改页面；只有收到实际完成结果才显示调用通过。任务的模型来源固定在启动时，继续会话必须属于同一项目和来源。

## 项目绑定与展示

内置 Agent 的宿主显式提供项目 MCP。其私有插件副本保留四个 Skill，移除外部插件的 library MCP 启动配置，避免同时接入整个内容库。连接失败时不改用创作 CLI 或另一个项目。

保存页面后使用 page_present 返回完整 HTML/source 和可选 inline 预览。当前内置聊天按文字与文件链接交付；它不因生成 inline 就具备对话 HTML 显示能力。文件路径由运行时分配，读取和保存沿用当前项目身份、hash/revision。

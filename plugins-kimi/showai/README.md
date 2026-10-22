# ShowAI for Kimi Work

**Language:** [English](#english) | [简体中文](#简体中文)

## English

This plugin includes a Skill and a local MCP launcher. It connects Kimi Work to the ShowAI runtime registered for the selected content library, shows components in conversation, and creates saved interactive pages through four stages: intent, material, logic and design.

### Install and update

1. Install and start ShowAI so it registers its runtime. This plugin requires the four-stage template workflow and the merged MCP tool surface (v2). Installing the plugin does not update ShowAI itself.
2. Register this directory (`plugins-kimi/showai`) as a local plugin in Kimi Work. In a Kimi Work session, ask it to register this directory using its built-in plugin manager. The MCP command runs with the installed plugin as its working directory. The launcher uses `sh` and Node.js 22.12+ from the host's PATH; Kimi for macOS supplies both. Other hosts need a POSIX shell and Node on PATH. The shell entry avoids Kimi's native-binary rewrite of a direct `node` manifest command, which does not launch JavaScript correctly in its Electron host.
3. Open **Plugins → Personal → ShowAI** and install or update it. Registration alone does not install the plugin. Verify that the plugin details list both the ShowAI Skill and the ShowAI MCP server.
4. Enable the plugin and verify a real `showai_capabilities` call. Tool names may have a host prefix. An existing conversation may need to refresh its available tools; use the host's refresh flow and verify the call again.

The default library is `~/.showai`. To select another library, set an absolute `SHOWAI_HOME` in this plugin's MCP environment and register the intended runtime for that library. `SHOWAI_RUNTIME_CONFIG` can select its runtime receipt, whose `home` must match. Reconnect after changing the host configuration. The launcher never scans other libraries or silently switches after a failure.

`SHOWAI_PROJECT_ID` optionally binds the connection to one project. `SHOWAI_TEMPLATES` requires that project binding. `SHOWAI_PRESENTATION_DIR` optionally selects an absolute host-owned preview directory; otherwise ShowAI uses its runtime preview directory. The plugin declares `SHOWAI_HOST_DISPLAY=fragment-file` for Kimi's file-based Widget delivery. This local launcher does not configure a remote MCP endpoint; a remote connection is configured separately by the host.

### Use and display

Ask to show a chart or mechanism in conversation, create a report saved to ShowAI, revise an existing page, or export an offline HTML file. The Skill distinguishes a temporary conversation visualization from a saved project page.

For a Widget, copy the returned offline inline file unchanged into the Widget workspace and execute Kimi's display action. Check the final compressed size and whether the file contains an online reader. If the offline preview exceeds the host's limit, deliver the complete offline HTML file or an explicitly selected subset. `delivery.compact` loads an online reader and is unsuitable for a Widget that blocks network requests. Saving, cloud synchronization and visible Widget rendering are verified separately.

If tools cannot be found, check the plugin's MCP section and startup error first. Confirm the installed version, registered library and runtime. Reinstalling a Skill-only version cannot add MCP tools. Do not create a different page or switch libraries to work around a connection failure.

See [Agent integration](https://github.com/Renaissance-Mind/ShowAI/blob/main/docs/agent-integration.md) for other connection types.

## 简体中文

本插件包含 Skill 和本机 MCP 启动器，连接所选内容库已注册的 ShowAI 运行时。支持在对话里直接展示组件，以及按理解意图、收集材料、呈现逻辑、设计稿四阶段创建可保存的交互页面。

### 安装与更新

1. 安装并启动 ShowAI，让应用注册运行时。运行时需要支持四阶段模板流程与合并后的 MCP 工具接口（v2）；安装插件不会更新 ShowAI 应用。
2. 将本目录（`plugins-kimi/showai`）注册为 Kimi Work 本机插件。可以在 Kimi Work 会话里要求它使用内置插件管理工具注册该目录。MCP 以安装后的插件目录为工作目录，通过 `sh` 调用宿主 PATH 中的 Node.js 22.12+；macOS 版 Kimi 自带所需环境，其他宿主需提供 POSIX shell 和 Node。该启动方式适配 Kimi 的 Electron 宿主，避免直接声明 `node` 时被重写为无法启动 JavaScript 的宿主内部子命令。
3. 打开「插件 → 个人 → ShowAI」并安装或更新。注册成功还不代表安装成功；插件详情应同时列出 ShowAI Skill 和 ShowAI MCP 服务。
4. 启用插件，实际调用一次 `showai_capabilities`。工具名称可能带宿主前缀；已有会话需要刷新可用工具时，沿宿主流程刷新后重新验证调用。

默认内容库为 `~/.showai`。选择其他内容库时，在本插件 MCP 环境中设置绝对路径 `SHOWAI_HOME`，并为该内容库注册目标运行时。可用 `SHOWAI_RUNTIME_CONFIG` 指定运行时回执，其 `home` 必须匹配。修改宿主配置后重新连接；启动器不会扫描其他库或在失败后自动换库。

`SHOWAI_PROJECT_ID` 可把连接绑定到一个项目；`SHOWAI_TEMPLATES` 需要同时绑定项目。`SHOWAI_PRESENTATION_DIR` 可指定宿主拥有的绝对预览目录，否则使用运行时预览目录。插件声明 `SHOWAI_HOST_DISPLAY=fragment-file`，适配 Kimi 读取文件的 Widget 展示。本启动器连接本机运行时；远程 MCP 由宿主单独配置。

### 使用与展示

可以直接要求在对话中展示图表或机制、制作保存到 ShowAI 的报告、续改已有页面，或导出离线 HTML。Skill 会按用户是否需要留存选择对话展示或项目页面。

Widget 使用返回的离线 inline 文件：原样复制到 Widget 工作区，再执行 Kimi 的显示动作。检查最终压缩大小和文件是否引用在线阅读器。离线预览超出宿主限制时，交付完整离线 HTML 或明确选区的预览。`delivery.compact` 依赖在线阅读器，不能用于阻止联网的 Widget。保存、云端同步和 Widget 实际显示分别验证。

找不到工具时，先检查插件的 MCP 部分及启动错误，再核对安装版本、注册的内容库与运行时。重装仅含 Skill 的旧版本不会补上 MCP 工具；连接失败时不通过另建页面或更换内容库绕过。

其他连接方式见 [Agent 接入](https://github.com/Renaissance-Mind/ShowAI/blob/main/docs/i18n/agent-integration.zh-CN.md)。

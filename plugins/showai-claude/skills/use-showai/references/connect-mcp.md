# 在 Claude Code 中连接 ShowAI

在 ShowAI 的「设置 → Agent 插件」安装或更新 Claude Code 插件，重启会话。在插件管理器核对 ShowAI 已启用，在 MCP 状态中检查连接。

打开新会话，调用 `showai_capabilities` 确认 ShowAI 可用，再用 `projects_list` 查看可访问的项目。项目绑定连接用 `project_context` 确认项目。

若会话只提供 `showai_connection_problem`，调用它并按回执修复所选内容库的运行时，再刷新连接。换库时在 ShowAI 选定目标库，按本页的安装步骤重新绑定并开启新会话。 若在宿主中另选了 HTTP 连接，检查该连接的服务地址、认证方式和项目范围，重新授权后调用 `projects_list`。

在 T3 Code 中使用 Claude Code 时，线程可复用同一提供方配置目录中的插件。独立目录在 ShowAI「设置 → Agent 插件 → T3 Code」复制 Claude Code 配置，然后在 T3 命令面板重启智能体会话。详见 [T3 Code 展示与编辑](host-display.md#t3-code)。

进一步排查见[运行时与错误码](runtime.md)。显示方式和已保存页面的打开方式见[当前宿主适配](host-adapter.md)。

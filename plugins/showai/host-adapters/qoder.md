# Qoder 展示适配

<!-- showai-host-delivery:start -->

- 临时可视化用 `show_component` 的 `delivery:"auto"` 在对话中展示。Qoder 的 MCP Apps 卡片支持交互。
- 新建或续改保存成功后，用 `card_present` 在聊天里留下原页卡片，多页用同一组交付。点击卡片可定位到当前任务已打开的 ShowAI 侧栏编辑器。用户要求打开右侧编辑器时，用 `card_open({projectId,pageId})`。需要定位组件时补充保存后读取到的 `blockId`。
- Qoder 的「更多」菜单可打开 ShowAI 全局工作台，任务右侧应用菜单可打开当前任务的工作台。连接或展示失败时保留原页并说明实际状态。

<!-- showai-host-delivery:end -->

本机插件与支持 Qoder 工作台的 ShowAI 运行时一起提供全局工作台和当前任务右侧工作台。对话预览通过 MCP Apps 呈现。编辑器中的页面来自插件绑定的 ShowAI 内容库。引用到对话需要宿主提供相应能力。

Qoder 负责新建右侧标签。当前任务已打开 ShowAI 侧栏时，卡片可以在其中定位原页。仅桌面 App 可用时，主按钮显示「从 ShowAI 打开」。用户指定要在右侧打开时，用 `card_open` 打开原页，并确认宿主右侧已显示目标页。需要在对话中阅读页面时用 `page_present`。只要文件时导出 HTML。

页面预览出现 `inlineError` 或超过对话预算时，按[页面展示](authoring.md)选择关键块重新展示，并提供可用的整页入口。

工具不可用时先检查插件和 MCP 连接，按[连接向导](connect-mcp.md)恢复。旧运行时可能仍提供基础工具，但没有 `card_open` 和工作台入口；提示更新运行时并重新连接，再确认实际显示。远程连接是否提供工作台入口以该连接实际暴露的工具为准。

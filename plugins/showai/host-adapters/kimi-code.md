# Kimi Code 展示适配

<!-- showai-host-delivery:start -->

- 临时可视化用 `show_component` 的 `delivery:"auto"`。交付返回的完整 HTML 文件，Kimi Code Desktop 有文件预览时可在宿主里打开。用户限定在聊天里直接交互时，核对会话能否呈现视图。仅有文件预览时，说明需要在文件预览中打开才能交互。
- 新建和续改保存成功后用 `card_present` 取得原页卡片文件，同时给出 `targets` 里的原页入口。用户要求读正文时用 `page_present`。
- 用户要在 Kimi Code Desktop 任务右侧编辑时，用 `workbench_page_url` 取得地址，再用会话可用的内置 Browser 打开。CLI 可以交付同一编辑链接供浏览器打开。

<!-- showai-host-delivery:end -->

访问项目时，按[连接向导](connect-mcp.md)核对绑定的内容库，再用 `projects_list` 选择项目。Kimi Code Desktop 的 Browser 能打开本机地址时，编辑保存到同一原页。会话运行在其他机器时，使用该机器可访问的连接与页面入口。没有交互文件预览时交付 `delivery.html` 和页面位置。用户要求只保存或只导出时，按要求交付。

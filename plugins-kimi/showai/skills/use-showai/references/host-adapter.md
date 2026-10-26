# Kimi Work 展示适配

此插件声明 `SHOWAI_HOST_DISPLAY=fragment-file`。首次确认当前入口确有 Widget 能力，读取宿主提供的工作区、显示动作与大小限制；不猜固定路径。

show_component 使用 `delivery:"auto"`，取得真实 delivery.inline 后，把完整文件原样复制到当前 Widget 的 workspace/index.html，再执行宿主显示动作。更新时复用该 Widget。不要逐字重写 HTML，不把文件路径当作已显示。

Widget 使用离线阅读器。核对最终压缩字节与宿主限制（以当前宿主说明为准），并确认没有切成在线阅读器。delivery.compact 和 delivery.online 依赖联网，不能用于阻止联网的 Widget。超限时交付完整离线 HTML，或按用户明确的选区展示；保留完整源 Page。

正式 Page 的局部预览用 page_present 的 blockIds；完整 HTML/source 仍保留全页。需要局部离线导出时按实际 page_export schema 带 blockIds、format:inline、components:bundled、reader:bundled 和宿主提供的 out。没有 Widget 时交付项目与页面身份及可用 HTML 文件。正文不输出其他宿主的展示引用。

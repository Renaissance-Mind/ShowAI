---
name: show-visual
description: 在聊天中用原创 HTML 直接展示一至五个可交互的图、机制演示、数据比较或界面原型。按这次内容自由设计，首次展示无需项目或组件目录。用户明确指定使用已有 ShowAI 组件时才查目录；用户要求注册复用时再提取参数并换数据验证。
---

# 对话展示

用户想在对话里看、探索或比较时，从要说明的关系和实际数据出发，自由编写 HTML、CSS 和 JavaScript。用户只说“画流程图”“做一张图表”或“用 ShowAI 展示”时也走原创 HTML。首次展示直接使用 `show_component`，无需查询组件索引、获取项目上下文、准备组件包或注册组件。普通文字讨论可以直接回答。需要做成报告、分享整份作品或续改 Page 时进入 [show-document](../show-document/SKILL.md)。

## 制作和展示

1. 确定读者要看出的关系，选择适合内容的图形和交互。数据、标注与图中状态来自用户材料。HTML 可以包含 SVG、Canvas、样式和脚本。使用响应式布局，提供可读标签与键盘可操作的控件。
2. 把自包含的 HTML 片段直接传给 `show_component({html})`。片段运行在独立沙箱里，脚本和样式放在片段内。多幅独立图用 `show_component({html:[{title,html},{title,html}]})`，按顺序分别展示，最多五幅。需要共享控件或联动的视图写在同一片段中。一次性展示可以把数据直接写进 HTML。
3. 按回执的 delivery 在当前宿主交付。回执的 source 保存各幅图的原始 HTML 和顺序，便于只改或注册其中一幅。保留本次调用的原始输入；远程预览有有效期。后续修改取回原图，修改源码并重新展示。正文只补充图中读出的结论。

<!-- showai-visual-principles:start -->

- **整体与局部都要设计。** 既考虑整份内容的布局与阅读流，也考虑每一部分怎样呈现。
- **优先用图表达。** 过程、机制、结构、空间关系和方案对比以图为主；只用段落或表格讲这几类内容，读者要在脑中自己搭画面。图片可来自真实素材，也可用图像生成制作。
- **机制图画出状态。** 对象持有的表、携带的地址、此刻的值都放进画面，变化处突出；有先后的机制按步骤展示，各步沿用同一布局，只改变这一步变化的部分。
- **文字补足图。** 图中没讲清的概念、条件和细节用文字说明；文字与相邻的图使用同一对象名称与数值，读者看得出两者对应。
- **文字排布保证可读。** 用加粗、颜色区分重点与层级，同类含义用同一种样式。

<!-- showai-visual-principles:end -->

## 使用已有组件

仅当用户明确说“用已有的 ShowAI 组件”、点名某个库组件或引用已有组件要求用它展示时，读[已有组件的展示方式](references/catalog.md)。已知 ID 直接读使用说明，需要挑选时才按需求查目录。

## 当前宿主交付

已绑定的宿主直接调用展示工具。显示能力未知时用 `showai_capabilities({view:"presentation"})` 查看 `presentation.show.html` 和 `declaredHostDisplay`。旧运行时只支持已有组件时，支持 HTML 文件展示的宿主可按其原生入口展示原创片段；其他宿主提示更新后重连。工具发现后仍缺少 ShowAI 或连接提示未授权时，按[连接向导](../use-showai/references/connect-mcp.md)恢复或配置连接。用户需要操作控件时说明所缺的展示能力，静态说明可先用 Mermaid 或表格。

<!-- showai-host-delivery:start -->

- 临时组件用 `show_component` 的 `delivery:"auto"` 在 MCP Apps 原生视图直接展示。视图已挂在工具调用处，回复只补充图中的结论，**不要再输出 `<agent-embed>` 或复制 `.inline.html`**。
- 新建或续改保存成功后，用最终回执的项目和页面 ID 调用 `card_present` 交付原页卡片；同一页只交付一次，多页放入同一次调用的 `additionalTargets`。
- 用户明确要求在消息里阅读原页或片段时用 `page_present`（按需传 `blockIds`）；要求在右侧/侧栏工作台打开页面或跳到某组件时用 `card_navigate`。缺少卡片工具或原生视图未出现时查完整宿主适配。

<!-- showai-host-delivery:end -->

按照回执的实际模式完成交付，异常时查[当前宿主适配](../use-showai/references/host-adapter.md)。普通 HTML 的交互在片段中运行。用户明确选用已有组件并需要在同一显示区分批推送数据时，按[已有组件的持续更新](references/catalog.md#分批更新同一个显示区)处理。

## 之后要保存

用户要保留当前 HTML 成品时，保留对应的 HTML 和交互，按请求交付文件。已展示的目录组件可以用原有数据[保存到页面](references/catalog.md#保存到页面)。需要整理为完整文档时按 show-document 处理。

用户明确要“注册”“做成组件以后换数据用”时，取回选中那一项的原始 HTML。本机读回回执的 source 文件；HTTP 可以按 artifactId 用 presentation_source 分块读回。缓存过期时沿用本次聊天中相同的工具输入。跨聊天且无法取回源码时，请用户提供原片段或含源码的展示回执。保留图形、样式和交互，把需要替换的业务数据提成参数，由 HTML 读取 `window.showaiData`。原始数据作为 defaultData，准备一组有真实含义且能观察出差异的替代数据。

用 `show_component({html:[{html,data:original},{html,data:alternate}]})` 对照同一份参数化 HTML 的两次渲染。核对原图的数值、标注与交互，操作替代数据的关键控件，验证图形或读数随新数据变化。注册时沿用明确的目标项目，需要选择时用 projects_list 确定归属。两组都通过后才按 [create-component](../create-component/SKILL.md) 补齐正式组件的名称、参数 schema 和使用说明。manifest.entry 使用 `visual.html`，source 使用刚验证的 HTML，manifest.examples 记录替代数据。调用 component_save 注册精确版本，再用保存回执的版本和两组数据复核。验证失败时修正同一份源码，保留原展示。

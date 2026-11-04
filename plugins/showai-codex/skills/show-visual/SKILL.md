---
name: show-visual
description: 在对话中直接展示 1–5 个 ShowAI 组件（图表、示意图、流程图、架构图、机制演示、模拟、对比、界面原型），不需要项目、不保存。用户要求画图或做可视化、想马上看到、探索或比较时使用；关注有哪些组件、怎样使用，以及现有组件不够时怎样改造或临时新建一个。组件可交互；展示后用户要存下这几个组件时按本 Skill 的“之后要保存”处理，要整理成文档、分享或续改已有页面时转 show-document。
---

# 对话展示

用一次 `show_component` 把组件直接放进对话。不需要项目、模板或制作流程，结果不写入内容库。

## 先判断

- **值不值得画。** 文字、Markdown 表格或 Mermaid 已经讲清时直接回答，不调用 ShowAI。画面要让读者看出文字说不清的关系、变化、空间结构，或能亲手调整参数。用户要求画图或做可视化时用 ShowAI 组件画：读者可以缩放、点开细节、切换视图，之后也能原样存进页面。
- **是不是展示。** 请求提到保存、文档、报告、项目、分享、发给别人，或是在续改一份已有 Page 时，进入 [show-document](../show-document/SKILL.md)。其余可视化请求按对话展示处理。
- **这张图回答什么。** 先写一句“读者看完能知道什么”，据此选组件、取数据；这是展示路径里唯一的意图记录。

画面遵循下面的视觉表达原则（与 show-document 的制作流程同源）：

<!-- showai-visual-principles:start -->

- **整体与局部都要设计。** 既考虑整份内容的布局与阅读流，也考虑每一部分怎样呈现。
- **优先用图表达。** 过程、机制、结构、空间关系和方案对比以图为主；只用段落或表格讲这几类内容，读者要在脑中自己搭画面。图片可来自真实素材，也可用图像生成制作。
- **机制图画出状态。** 对象持有的表、携带的地址、此刻的值都放进画面，变化处突出；有先后的机制按步骤展示，各步沿用同一布局，只改变这一步变化的部分。
- **文字补足图。** 图中没讲清的概念、条件和细节用文字说明；文字与相邻的图使用同一对象名称与数值，读者看得出两者对应。
- **文字排布保证可读。** 用加粗、颜色区分重点与层级，同类含义用同一种样式。

<!-- showai-visual-principles:end -->

## 制作

1. **选组件。** 内置组件不需要项目：用 `public_catalog_list({kind:"component"})` 取得索引（任何连接都有）；已持有 `project_context` 的 componentCatalog 时直接沿用，它还含该项目的自定义组件。按 description、scenarios 和 signature 选一个主组件。需要并排对照或“图加一段说明”时最多放 5 个；内容再多就应整理成文档。索引条目带 `conversation: "limited"` 表示放进对话有已知限制（详情见该组件 summary 的 conversation.note，show_component 也会在 warnings 里说明），`"unsuitable"` 表示不适合放进对话，改选其他组件或整理成文档。
   按读者要看出的关系选：流程与分支用 flowchart；“谁持有什么、这一步改了什么”的机制用 mechanism-diagram（对象可带小表格，steps 逐步切换）；参与者之间的往返用 sequence-diagram；数据用 chart 或 G2 图表；没有现成组件的示意图用 svg 手绘。顺序是先调整数据，再组合已有组件，最后才改造或新写。
   现有组件差一点时改造它：用 `public_catalog_describe({id,view:"source"})`（项目组件用 `catalog_describe`）取得源码，按 [create-component](../create-component/SKILL.md) 修改。目录里没有合适的组件时，先告诉用户可以用文字或表格回答，或临时写一个组件；选择写组件时同样按 create-component 编写。改造或新写的组件都用 `componentSources` 预览，格式与 `component_save` 的 source 相同（manifest、schema、source，可选 files、assets），预览不要求 manifest.documentation；块里写 `{kind:"custom",data:{componentId:manifest.id,version:manifest.version,props}}`，不必先保存；用户要复用时再按 use-showai 确定项目后保存。
2. **读 guide。** 内置组件用 `public_catalog_describe({id,view:"guide"})`；项目自定义组件用 `catalog_describe({projectId,id,view:"guide"})`。按 schema 填真实数据，不补造数字；本轮已读过同一版本时不重复读。
3. **调用。** `show_component({kind,data})`，多个组件用 `blocks:[{kind,data},…]`。data 与 `page_apply` 的 `component.insert` 完全相同。自定义组件写 `{kind:"custom",data:{componentId,version,integrity?,props}}`，integrity 取自目录条目；它保存在某个项目里时再传 `projectId`，只用于查找组件，不写入项目。开发中的组件包用 `componentSources` 预览。
4. **回复。** 按返回的 delivery 交付（见下）。正文只写画面帮读者看出的一两点，不复述数据，不介绍工具或文件。

## 交付

先读 [当前宿主适配](../use-showai/references/host-adapter.md)，再调用 show_component；通用规则见 [宿主显示](../use-showai/references/host-display.md)。默认 delivery:auto 跟随该连接声明；按实际返回的 delivery.mode 执行适配指南中的显示动作，例如 `mode:"compact"` 时把 `delivery.compact` 原样交给宿主的 HTML 展示工具。

宿主已经呈现原生组件视图时，最终回复只补充必要解释。文件、HTML 片段、图片等交付按当前适配指南处理，不向用户输出供其他 Harness 使用的展示指令。没有可执行的显示契约时，说明缺项并保留内容与可用文件。

工具成功不等于用户已看到。warnings、宿主加载错误或原样指令都要按当前适配排查。display.resourceAttached:true 只说明附带了资源。读者控件的 showai.readerState 是临时状态；展示没有 Page 身份，不能声称已保存。

## 之后要保存

用户说“存下来”时，只存这几个组件：按 [use-showai](../use-showai/SKILL.md) 确定项目，用 `page_create({projectId,blocks})` 或 `component.insert` 原样写入同一份 {kind,data}（自定义组件沿用返回的 version 与 integrity；只用 componentSources 预览过的组件先按 create-component 用 `component_save` 保存，再引用回执中的版本），再 `page_present`。读者在预览里调整的取值（`showai.readerState`）不会自动写入：用户要保留调整后的状态时，先说明会改哪些字段，再写进 data。要把多次展示整理成一份文档时按 show-document 的流程制作，已有展示作为材料。

展示本身没有保存，不要说已保存；连接或保存失败时也不改用展示了事。

当前连接没有 `show_component` 时，说明 ShowAI 运行时早于这项能力，需要更新 App 后重新连接；本次可用 `render_document` 传入只含这些组件的文档代替，同样不保存。完全没有 ShowAI 连接时，说明连接不可用（见 [use-showai](../use-showai/SKILL.md)）；对话展示可以先用 Mermaid 或 Markdown 表格回答，并说明这不是 ShowAI 组件。

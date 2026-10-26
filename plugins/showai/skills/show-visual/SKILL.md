---
name: show-visual
description: 在对话中直接展示 1–5 个 ShowAI 组件（图表、示意图、流程、机制演示、模拟、对比、界面原型），不建项目、不保存。用户想马上看到、探索或比较，且没有要求保存、整理成文档、分享或续改已有页面时使用；要留存时转 show-document。
---

# 对话展示

用一次 `show_component` 把组件直接放进对话。不需要项目、模板或四个阶段，结果不写入内容库。

## 先判断

- **值不值得画。** 文字、Markdown 表格或 Mermaid 已经讲清时直接回答，不调用 ShowAI。画面要让读者看出文字说不清的关系、变化、空间结构，或能亲手调整参数。用户明确要某种图时直接画：结构简单、用 Mermaid 已能讲清时用 Mermaid；需要交互、精确排版或数据驱动时用 ShowAI 组件。
- **是不是展示。** 请求提到保存、文档、报告、项目、分享、发给别人，或是在续改一份已有 Page 时，进入 [show-document](../show-document/SKILL.md)。其余可视化请求按对话展示处理。
- **这张图回答什么。** 先写一句“读者看完能知道什么”，据此选组件、取数据；这是展示路径里唯一的意图记录。

## 制作

1. **选组件。** 内置组件不需要项目：用 `public_catalog_list({kind:"component"})` 取得索引（任何连接都有）；已持有 `project_context` 的 componentCatalog 时直接沿用，它还含该项目的自定义组件。按 description、scenarios 和 signature 选一个主组件。需要并排对照或“图加一段说明”时最多放 5 个；内容再多就应整理成文档。索引条目带 `conversation: "limited"` 表示放进对话有已知限制（详情见该组件 summary 的 conversation.note，show_component 也会在 warnings 里说明），`"unsuitable"` 表示不适合放进对话，改选其他组件或整理成文档。
   目录里没有合适的组件时，先告诉用户：可以用文字或表格回答，或临时写一个组件。选择写组件时按 [create-component](../create-component/SKILL.md) 编写，用 `componentSources` 预览，格式与 `component_save` 的 source 相同（manifest、schema、source，可选 files、assets）；用户要复用时再保存。
2. **读 guide。** 内置组件用 `public_catalog_describe({id,view:"guide"})`；项目自定义组件用 `catalog_describe({projectId,id,view:"guide"})`。按 schema 填真实数据，不补造数字；本轮已读过同一版本时不重复读。
3. **调用。** `show_component({kind,data})`，多个组件用 `blocks:[{kind,data},…]`。data 与 `page_apply` 的 `component.insert` 完全相同。自定义组件写 `{kind:"custom",data:{componentId,version,integrity?,props}}`，integrity 取自目录条目；它保存在某个项目里时再传 `projectId`，只用于查找组件，不写入项目。开发中的组件包用 `componentSources` 预览。
4. **回复。** 按返回的 delivery 交付（见下）。正文只写画面帮读者看出的一两点，不复述数据，不介绍工具或文件。

## 交付

先读 [宿主显示](../use-showai/references/host-display.md) 与其中绑定的当前宿主适配，再调用 show_component。默认 delivery:auto 跟随该连接声明；按实际返回的 delivery.mode 执行适配指南中的显示动作。

宿主已经呈现原生组件视图时，最终回复只补充必要解释。文件、HTML 片段、图片等交付按当前适配指南处理，不向用户输出供其他 Harness 使用的展示指令。没有可执行的显示契约时，说明缺项并保留内容与可用文件。

工具成功不等于用户已看到。warnings、宿主加载错误或原样指令都要按当前适配排查。display.resourceAttached:true 只说明附带了资源。读者控件的 showai.readerState 是临时状态；展示没有 Page 身份，不能声称已保存。

## 之后要保存

用户说“存下来”“整理成文档”时转 show-document。只存这几个组件时，按 [use-showai](../use-showai/SKILL.md) 确定项目，用 `page_create({projectId,blocks})` 或 `component.insert` 原样写入同一份 {kind,data}（自定义组件沿用返回的 version 与 integrity），再 `page_present`。读者在预览里调整的取值（`showai.readerState`）不会自动写入：用户要保留调整后的状态时，先说明会改哪些字段，再写进 data。要把多次展示整理成一份文档时进入四个阶段，已有展示作为材料。

展示本身没有保存，不要说已保存；连接或保存失败时也不改用展示了事。

当前连接没有 `show_component` 时，说明 ShowAI 运行时早于这项能力，需要更新 App 后重新连接；本次可用 `render_document` 传入只含这些组件的文档代替，同样不保存。完全没有 ShowAI 连接时，说明连接不可用（见 [use-showai](../use-showai/SKILL.md)）；对话展示可以先用 Mermaid 或 Markdown 表格回答，并说明这不是 ShowAI 组件。

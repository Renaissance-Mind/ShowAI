---
name: show-visual
description: 在对话中直接展示 1–5 个 ShowAI 组件（图表、示意图、流程、机制演示、模拟、对比、界面原型），不建项目、不保存。用户想马上看到、探索或比较，且没有要求保存、整理成文档、分享或续改已有页面时使用；要留存时转 show-document。
---

# 对话展示

用一次 `show_component` 把组件直接放进对话。不需要项目、模板或四个阶段，结果不写入内容库。

## 先判断

- **值不值得画。** 文字、Markdown 表格或 Mermaid 已经讲清时直接回答，不调用 ShowAI。画面要让读者看出文字说不清的关系、变化、空间结构，或能亲手调整参数。
- **是不是展示。** 请求提到保存、文档、报告、项目、分享、发给别人，或是在续改一份已有 Page 时，进入 [show-document](../show-document/SKILL.md)。其余可视化请求按对话展示处理。
- **这张图回答什么。** 先写一句“读者看完能知道什么”，据此选组件、取数据；这是展示路径里唯一的意图记录。

## 制作

1. **选组件。** 从组件索引（本机连接 `project_context` 的 componentCatalog，公共连接 `public_catalog_list`）按 description、scenarios 和 signature 选一个主组件。需要并排对照或“图加一段说明”时最多放 5 个；内容再多就应整理成文档。索引条目带 `conversation: "limited"` 表示放进对话有已知限制（详情在 catalog_describe 的 conversation.note），`"unsuitable"` 表示不适合放进对话，改选其他组件或整理成文档。
2. **读 guide。** `catalog_describe({projectId,id,view:"guide"})`，公共连接用 `public_catalog_describe`。按 schema 填真实数据，不补造数字；本轮已读过同一版本时不重复读。
3. **调用。** `show_component({kind,data})`，多个组件用 `blocks:[{kind,data},…]`。data 与 `page_apply` 的 `component.insert` 完全相同。自定义组件写 `{kind:"custom",data:{componentId,version,props}}`；它保存在某个项目里时再传 `projectId`，只用于查找组件，不写入项目。开发中的组件包用 `componentSources` 预览。
4. **回复。** 按返回的 delivery 交付（见下）。正文只写画面帮读者看出的一两点，不复述数据，不介绍工具或文件。

## 交付

`delivery` 默认 auto，跟随插件声明的宿主显示方式；结果里的 `delivery.mode` 是实际采用的方式：

- `mcp-app`：宿主显示附带的组件视图，无需额外操作。
- `fragment-file`：Codex 在最终回复单独一行写 `visualize{"path":"返回的 delivery.inline"}`；其他读取文件的宿主按自己的显示方式使用这个文件。
- `compact`：把 `delivery.compact` 原样交给宿主中由模型写 HTML 的可视化工具（如 Claude 的 show_widget）；它从公共 CDN 加载阅读器。
- `image`：结果附带 PNG，用于没有交互显示的宿主。

工具成功不等于已经显示。warnings 说明宿主未声明显示能力或片段超出预算时，按宿主实际能力换一种 delivery 重试；各宿主规则见 [宿主显示](../use-showai/references/host-display.md)。读者在组件里调整的取值会以 `showai.readerState` 进入上下文，用于“按这个继续”之类的追问。

## 之后要保存

用户说“存下来”“整理成文档”时转 show-document。只存这几个组件时，按 [use-showai](../use-showai/SKILL.md) 确定项目，用 `page_create({projectId,blocks})` 或 `component.insert` 原样写入同一份 {kind,data}（自定义组件沿用返回的 version 与 integrity），再 `page_present`。要把多次展示整理成一份文档时进入四个阶段，已有展示作为材料。

展示本身没有保存，不要说已保存；连接或保存失败时也不改用展示了事。

当前连接没有 `show_component` 时，说明 ShowAI 运行时早于这项能力，需要更新 App 后重新连接；本次可用 `render_document` 传入只含这些组件的文档代替，同样不保存。

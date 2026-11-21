---
name: show-visual
description: 在对话中直接展示 1–5 个 ShowAI 组件（图表、示意图、流程图、架构图、机制演示、模拟、对比、界面原型），不需要项目、不保存。用户要求画图或做可视化、想马上看到、探索或比较时使用；关注有哪些组件、怎样使用，以及现有组件不够时怎样改造或临时新建一个。组件可交互；展示后用户要存下这几个组件时按本 Skill 的“之后要保存”处理，要整理成文档、分享或续改已有页面时转 show-document。
---

# 对话展示

通用插件已安装但没有 ShowAI 工具，或连接提示未授权时，按[连接向导](../use-showai/references/connect-mcp.md)完成手动接入，再回来展示。

只在当前对话展示内置组件时，从本 Skill 开始。直接使用当前连接的 `public_catalog_list`、`public_catalog_describe` 和 `show_component`。如果工具按需加载，用宿主的工具搜索或选择功能一次取出本次需要的工具，沿用实际前缀。已知组件 ID 或已持有索引时只取后两项。在支持持续更新的宿主中，数据分批到达时先展示第一批有效内容，再更新同一显示区。展示结果不写入内容库。

跨组件联动先读 showai_capabilities.componentRuntime 和组件 view:"contract"；按照公开事件与稳定对象绑定，legacy 包不推断事件能力。需要临时创建或改造组件时采用 create-component 的统一契约与真实编译验证。

## 先判断

- **值不值得画。** 文字、Markdown 表格或 Mermaid 已经讲清时直接回答，不调用 ShowAI。画面要让读者看出文字说不清的关系、变化、空间结构，或能亲手调整参数。用户要求画图或做可视化时用 ShowAI 组件画：读者可以缩放、点开细节、切换视图，之后也能原样存进页面。
- **是不是展示。** 用户只想把已经展示的组件原样存下来时，按本技能的“之后要保存”处理；持续展示先读回最新结果。要整理成文档、报告、项目作品、可分享的完整内容，或续改已有 Page 时，进入 [show-document](../show-document/SKILL.md)。其余可视化请求按对话展示处理。
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

1. **选组件。** 已知内置组件 ID 时直接读它的 guide。需要挑选时，一次调用 `public_catalog_list({kind:"component",view:"compact"})`，省略 limit 和 cursor 即可拿全目录。按 columns 读取每行的 id、name 和一个使用场景；可加 query 缩小范围。工具尚未提供 view 参数时，沿用原有目录并用 query 筛选。已持有项目的 componentCatalog 时直接沿用，它还含项目组件。选择一个主组件，需要并排对照时最多放 5 个。
   按读者要看出的关系选：多层点击展开用 multi-level-view，每层用原生 content 承载已有组件，按组件块 ID 与公开的 type/scope/id 事件绑定下一层；流程与分支用 flowchart；“谁持有什么、这一步改了什么”的机制用 mechanism-diagram（对象可带小表格，steps 逐步切换）；参与者之间的往返用 sequence-diagram；数据用 chart 或 G2 图表；没有现成组件的示意图用 svg 手绘。顺序是先调整数据，再组合已有组件，最后才改造或新写。
   现有组件差一点时改造它：用 `public_catalog_describe({id,view:"source"})`（项目组件用 `catalog_describe`）取得源码，按 [create-component](../create-component/SKILL.md) 修改。目录里没有合适的组件时，先告诉用户可以用文字或表格回答，或临时写一个组件；选择写组件时同样按 create-component 编写。改造或新写的组件都用 `componentSources` 预览，格式与 `component_save` 的 source 相同（manifest、schema、source，可选 files、assets），预览不要求 manifest.documentation；块里写 `{kind:"custom",data:{componentId:manifest.id,version:manifest.version,props}}`，不必先保存；用户要复用时再按 use-showai 确定项目后保存。
2. **读 guide。** 内置组件用 `public_catalog_describe({id,view:"guide"})`；项目自定义组件用 `catalog_describe({projectId,id,view:"guide"})`。按 schema 填真实数据，同一版本的 guide 可以复用。若 guide 的 `conversation.status` 为 `limited`，按 `conversation.note` 调整展示；为 `unsuitable` 时改选组件或整理成文档。
3. **调用。** `show_component({kind,data})`，多个组件用 `blocks:[{kind,data},…]`。data 与 `page_apply` 的 `component.insert` 完全相同。自定义组件写 `{kind:"custom",data:{componentId,version,integrity?,props}}`，integrity 取自目录条目；它保存在某个项目里时再传 `projectId`，只用于查找组件，不写入项目。开发中的组件包用 `componentSources` 预览。
4. **回复。** 按返回的 delivery 交付（见下）。正文只写画面帮读者看出的一两点，不复述数据，不介绍工具或文件。

## 当前宿主交付

本机插件和远程 MCP Apps 已绑定当前交付方式，或同一连接的显示能力已经核实时，一次性展示直接执行上面的制作步骤。若只需确认未知或变更连接的显示声明，调用 `showai_capabilities({view:"presentation"})`，读取 `presentation.declaredHostDisplay` 和 `presentation.show.maxComponents`。旧运行时没有 view 参数时才取完整报告。声明为 `undeclared` 时按宿主实际提供的显示动作交付，回执与预期不同再查完整适配。

<!-- showai-host-delivery:start -->

- 使用当前 Widget 的工作区、大小上限与显示动作。已注册的工具可直接调用；当前会话提供 `select_tools` 且延迟加载时，一次选择用到的 ShowAI 工具。用 `show_component` 的 `delivery:"auto"` 取得 `fragment-file`。
- 核对 `display.reader:"bundled"` 和压缩大小，把回执的 `delivery.inline` 原样复制到该 Widget 的 `workspace/index.html`，执行显示动作。
- 新作品保存后用 `page_present` 预览，续改给出所在项目、改动和原页链接。缺少 Widget、超限或阅读器为 `cdn` 时查完整宿主适配。

<!-- showai-host-delivery:end -->

按回执的实际模式交付。异常与回退见[完整宿主适配](../use-showai/references/host-adapter.md)。工具成功和 `display.resourceAttached:true` 只表明生成或附带了资源。预览中的 `showai.readerState` 是临时阅读状态。

### 分批更新同一个显示区

只有需要分批更新时，核对 `showai_capabilities.presentation.liveUpdates` 和当前宿主的 MCP Apps `serverTools` 回调能力。`available:true` 表示服务端提供更新入口。文件片段、图片和模型填写 HTML 的宿主采用一次性交付。

第一次用 `show_component({kind,data,live:true,delivery:"mcp-app"})`，或同样的 blocks 输入。第一批数据也必须完整合法，不能为了提前显示补造数据。保留回执 `live.viewId`、`live.revision` 和 `blocks[].id`，核实显示区已经出现；不要等全部内容生成后才首次展示。

后续调用 `show_component_update({viewId,operationId,baseRevision,operations,complete?})`。operations 沿用 page_apply 的稳定节点操作，例如 `{type:"component.props.set",blockId,props:{labels:[…],series:[…]}}`；props 中每个顶层字段整体替换，相关字段放在同一批。按完整段落、图表数据批次或记录更新，小任务一次给完。没有生成新组件版本时，继续使用已有组件；此接口不能导入新的组件包或写项目数据。

每次沿用新 revision；最近一次响应丢失时，使用完全相同的 operationId 和输入重试。CONFLICT 时调用 `show_component_read({viewId,source:true})` 读出当前 artifact，比较后重新组织操作，不能只替换版本号覆盖。无效批次保留原内容与版本。最后一批带 `complete:true`，也可用空 operations 完成。完成后可读、可保存，但不再接受修改。

同一 MCP 连接最多保留 32 个显示区，单份完整源最多 16 MiB，30 分钟未访问会过期；重连后原 viewId 不再可用。读取器会自行取回更新，这些读取不启动模型回合。连接中断时保留最后有效画面并报告错误。用户不再需要该临时结果时可用 `show_component_close({viewId})` 释放；它不删除已保存页面。

用户要求保存持续展示时，先 `show_component_read({viewId,source:true})` 取最新 artifact，再沿正常项目归属保存 artifact.document 及其 components。若返回 componentSources，先用 component_save 保存这些包，再沿回执的精确版本引用写入 Page，保留可编辑组件源码。确认 Page 保存成功后再关闭临时显示。保存的是最新完整内容，不是最初传给 show_component 的那批参数。

## 之后要保存

用户说“存下来”时，只存这几个组件：按 [use-showai](../use-showai/SKILL.md) 确定项目，用 `page_create({projectId,blocks})` 或 `component.insert` 原样写入同一份 {kind,data}（自定义组件沿用返回的 version 与 integrity；只用 componentSources 预览过的组件先按 create-component 用 `component_save` 保存，再引用回执中的版本）。保存成功后，按上文「当前宿主交付」给出原页入口。读者在预览里调整的取值（`showai.readerState`）不会自动写入：用户要保留调整后的状态时，先说明会改哪些字段，再写进 data。要把多次展示整理成一份文档时按 show-document 的流程制作，已有展示作为材料。

展示本身没有保存，不要说已保存；连接或保存失败时也不改用展示了事。

在已连接且已刷新工具的旧运行时缺少 `show_component` 时，更新 App 后重新连接；本次可用 `render_document` 传入只含这些组件的文档代替，同样不保存。完全没有 ShowAI 连接时，说明连接不可用（见 [use-showai](../use-showai/SKILL.md)）；对话展示可以先用 Mermaid 或 Markdown 表格回答，并说明这不是 ShowAI 组件。

# 展示用户指定的已有组件

1. **选组件。** 已知内置组件 ID 时直接读它的 guide。需要挑选时，一次调用 `public_catalog_list({kind:"component",view:"compact"})`，省略 limit 和 cursor 即可拿全目录。按 columns 读取每行的 id、name 和一个使用场景；可加 query 缩小范围。工具尚未提供 view 参数时，沿用原有目录并用 query 筛选。已持有项目的 componentCatalog 时直接沿用，它还含项目组件。选择一个主组件，需要并排对照时最多放 5 个。
   按读者要看出的关系选：多层点击展开用 multi-level-view，每层用原生 content 承载已有组件，按组件块 ID 与公开的 type/scope/id 事件绑定下一层；流程与分支用 flowchart；“谁持有什么、这一步改了什么”的机制用 mechanism-diagram（对象可带小表格，steps 逐步切换）；参与者之间的往返用 sequence-diagram；数据用 chart 或 G2 图表；没有现成组件的示意图用 svg 手绘。顺序是先调整数据，再组合已有组件，最后才改造或新写。
   现有组件差一点时改造它：用 `public_catalog_describe({id,view:"source"})`（项目组件用 `catalog_describe`）取得源码，按 [create-component](../../create-component/SKILL.md) 修改。目录里没有合适的组件时，先告诉用户可以用文字或表格回答，或临时写一个组件；选择写组件时同样按 create-component 编写。改造或新写的组件都用 `componentSources` 预览，格式与 `component_save` 的 source 相同（manifest、schema、source，可选 files、assets），预览不要求 manifest.documentation；块里写 `{kind:"custom",data:{componentId:manifest.id,version:manifest.version,props}}`，不必先保存；用户要复用时再按 use-showai 确定项目后保存。
2. **读 guide。** 内置组件用 `public_catalog_describe({id,view:"guide"})`；项目自定义组件用 `catalog_describe({projectId,id,view:"guide"})`。按 schema 填真实数据，同一版本的 guide 可以复用。若 guide 的 `conversation.status` 为 `limited`，按 `conversation.note` 调整展示；为 `unsuitable` 时改选组件或整理成文档。
3. **调用。** `show_component({kind,data})`，多个组件用 `blocks:[{kind,data},…]`。data 与 `page_apply` 的 `component.insert` 完全相同。自定义组件写 `{kind:"custom",data:{componentId,version,integrity?,props}}`，integrity 取自目录条目；它保存在某个项目里时再传 `projectId`，只用于查找组件，不写入项目。开发中的组件包用 `componentSources` 预览。

### 分批更新同一个显示区

只有需要分批更新时，核对 `showai_capabilities.presentation.liveUpdates` 和当前宿主的 MCP Apps `serverTools` 回调能力。`available:true` 表示服务端提供更新入口。文件片段、图片和模型填写 HTML 的宿主采用一次性交付。

第一次用 `show_component({kind,data,live:true,delivery:"mcp-app"})`，或同样的 blocks 输入。第一批数据也必须完整合法，不能为了提前显示补造数据。保留回执 `live.viewId`、`live.revision` 和 `blocks[].id`，核实显示区已经出现；不要等全部内容生成后才首次展示。

后续调用 `show_component_update({viewId,operationId,baseRevision,operations,complete?})`。operations 沿用 page_apply 的稳定节点操作，例如 `{type:"component.props.set",blockId,props:{labels:[…],series:[…]}}`；props 中每个顶层字段整体替换，相关字段放在同一批。按完整段落、图表数据批次或记录更新，小任务一次给完。没有生成新组件版本时，继续使用已有组件；此接口不能导入新的组件包或写项目数据。

每次沿用新 revision；最近一次响应丢失时，使用完全相同的 operationId 和输入重试。CONFLICT 时调用 `show_component_read({viewId,source:true})` 读出当前 artifact，比较后重新组织操作，不能只替换版本号覆盖。无效批次保留原内容与版本。最后一批带 `complete:true`，也可用空 operations 完成。完成后可读、可保存，但不再接受修改。

同一 MCP 连接最多保留 32 个显示区，单份完整源最多 16 MiB，30 分钟未访问会过期；重连后原 viewId 不再可用。读取器会自行取回更新，这些读取不启动模型回合。连接中断时保留最后有效画面并报告错误。用户不再需要该临时结果时可用 `show_component_close({viewId})` 释放；它不删除已保存页面。

用户要求保存持续展示时，先 `show_component_read({viewId,source:true})` 取最新 artifact，再沿正常项目归属保存 artifact.document 及其 components。若返回 componentSources，先用 component_save 保存这些包，再沿回执的精确版本引用写入 Page，保留可编辑组件源码。确认 Page 保存成功后再关闭临时显示。保存的是最新完整内容，不是最初传给 show_component 的那批参数。


## 保存到页面

用户说“存下来”时，只存这几个组件：按 [use-showai](../../use-showai/SKILL.md) 确定项目，用 `page_create({projectId,blocks})` 或 `component.insert` 原样写入同一份 {kind,data}（自定义组件沿用返回的 version 与 integrity；只用 componentSources 预览过的组件先按 create-component 用 `component_save` 保存，再引用回执中的版本）。保存成功后，按[当前宿主适配](../../use-showai/references/host-adapter.md)给出原页入口。读者在预览里调整的取值（`showai.readerState`）不会自动写入：用户要保留调整后的状态时，先说明会改哪些字段，再写进 data。要把多次展示整理成一份文档时按 show-document 的流程制作，已有展示作为材料。
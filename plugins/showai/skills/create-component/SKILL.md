---
name: create-component
description: 通过 ShowAI MCP 创建或改造可复用 React 组件。先查目录和评估组合，维护可查询的参数契约，再补齐确实缺少的图形、表达或交互能力。
---

沿用已核实MCP连接、项目和页面；缺少时读 [use-showai](../use-showai/SKILL.md)。正式资源保存到目标项目；开发中想先在对话里看效果时，把源码对象作为 `show_component` 的 componentSources 预览；用户明确要独立文件时交给render_document。两者都不自动创建个人项目。

用[设计稿](../design-presentation/references/design-draft.md)明确图形关系、状态与通过条件。组件负责稳定的数据表达和交互，实例保存本次事实；通用、专题和内容专用的复用边界分别判断。usage 的 purpose/structure/constraints 说明理解任务、视觉编码、空态、窄屏与静态方式，interactions 说明操作和保存边界；继续使用当前 documentation schema，不添加未经支持的参数。跨组件联动先核实实际接口，只有具体复用需求成立时才提炼共享能力。多个页面或组件要读写同一份数据时用项目的 [共享数据](../use-showai/references/shared-data.md)，组件不自建同步接口，只需按 [组件设计](references/component-authoring.md) 的要求处理 data 与条目 id。

先明确内容输入、读者操作及可见结果。先取得或复用project_context的componentCatalog；目录变化时用catalog_list更新。catalog_describe先取guide，再用view=parameters按字段/子树读取类型、含义、遗漏行为、真实例子与关系约束；schema/examples按需读取；调整数据或组合即可达到目标时复用。需要新实现时读取 [组件设计](references/component-authoring.md)及guide({topic:"component"})。读取详情或源码时沿用目录或页面引用中的scope、version、integrity，准确区分同名组件；实现开发先取development，再只取选中组件所需的source文件；修改已有组件时需要它的全部源码文件与资源，因为component_save保存完整的包：本机连接用 `catalog_describe({projectId,id,scope,version,integrity,view:"source",out:"/绝对路径/新文件夹"})` 把整个组件包写进一个文件夹（放在任务工作目录，不放进内容库；文件夹须不存在或为空，否则加 overwrite:true 覆盖同名文件），在文件夹里修改后提高 manifest.version，再用 directory 保存；远程连接用 view:"source" 与 file:"*" 读取。

大源码或资源包在保存前读取 showai_capabilities 的 capacities，按 [容量与大文件](../show-document/references/capacity.md) 分别检查源码、原始资源、实例数据和编译输出；文件资源预算不代表编译后的 data URI 代码也能达到同样大小。读者只需在本机查看的大文件（如视频原片）不必内嵌，用本机文件链接，见 [组件设计](references/component-authoring.md) 的「本机文件」。

本机与远程均调用component_save，契约相同。远程连接传 source（manifest、schema、source 及可选 files/assets）；本机连接（`showai_capabilities.authoring.localFiles.available` 为 true）源码或资源较大时，把组件包写成一个文件夹（manifest.json、props.schema.json、manifest.entry 指向的入口及其他 files/assets），用 `component_save({projectId,directory:"/绝对路径/组件包"})` 保存，不把整份源码和 base64 资源抄进调用；文件格式错误时回执指出文件、行与列。directory 同样要求 manifest.documentation；只有导入早于这项要求的已有旧版组件包时才加 `legacy:true`。manifest含id、name、version、description、scenarios、entry、defaultData、examples；默认数据和例子都需满足schema。新创作还必须提供manifest.documentation：version=2，reuse（kind、boundaries，内容专用还需owner）、usage（用途、结构、输入含义、操作、保存、限制、示例步骤与修改边界）、development（入口、架构、扩展点、不变量与验证）。参数规范见 [参数契约](references/parameter-contract.md)，实际字段以guide component返回的documentationSchema为准。recipe.exampleIndex对应真实示例索引。说明与代码随新版本保存；旧版缺项不冒充通用。修改仍是 documentation v1 的已有组件时，宜在新版本中补齐为 v2，无法补齐的项明确标为缺失。源码接收data、onChange、readOnly、goTo。正式编辑通过onChange返回有效数据；阅读探索使用本地状态；点击后跳到其他页面或块用goTo，见 [组件设计](references/component-authoring.md#跳转到页面或组件)。有对话的宿主还会传入onContext与context，让读者把当前探索状态交给对话，见 [组件设计](references/component-authoring.md#交给对话) 的「交给对话」。

可以使用React、包内模块、showai:components及明确声明精确依赖的showai:component/ID。新版本不可覆盖旧版本。页面用kind=custom和data={componentId,version,integrity,props}引用保存回执中的精确版本，不把包ID当作内置kind。

先检查宿主已有选中、右键和悬停扩展点，复用操作、菜单容器与定位。阅读控件按其理解任务组织；编辑动作不进入只读导出。具体验证见组件设计参考。

保存编译成功后，把组件放入真实Page，读取源数据、检查图像与实际交互，再重新读取确认保存。仅声明readData不证明计算结果正确；按稳定ID核对原始值与派生值。独立结果用render_document验证传入源码，交付可编辑输入及HTML/source。连接或编译失败时保留材料并报告，不转用CLI或未保存网页假装成功。

## 页面升级到新版本

新版本保存后，已有页面仍引用旧版本。用 `catalog_references({projectId,kind:"component",id:实际的componentId,version:旧版本,integrity:旧指纹})` 反查引用；回执的 pages 按页面列出 pageId 与 blockIds。需要正文或源码搜索时再用 library_search。只在用户授权的页面上升级：每个页面先 page_read 取 baseHash/baseRevision，再用一次 page_apply（新版本可以在本项目或全局、已发布范围，按 catalog_list 返回的精确 version 与 integrity 引用），每个块一条 `{type:"component.ref.set",blockId,version:新版本,integrity:新指纹}`（`showai_capabilities.authoring.pageOperations` 含 component.ref.set 时可用；旧运行时说明需要更新 ShowAI）（换成另一个组件 ID 时加 componentId）。它保留块 ID、props 与共享数据绑定，只改引用；props（绑定块按共享数据解析后的 props）不符合新版本 schema 时报出具体字段、什么都不保存，先按新契约改数据再升级。由旧版本 schema 派生的共享数据 schema 随之更新，回执的 datasetSchemas 说明；回执 warnings 的 DATASET_SHARED 表示其他页面的块也显示这份数据，这些块之后写回共享数据时同样按新 schema 检查：其中同一组件的块按用户意思决定是否一起升级，其他组件（如用 collections 映射的日程表格）不需要升级，只需告诉用户。块绑定的共享数据（page_read 的 bindings）在 dataset_read 中 `dataset.origin.componentId` 是这个组件、schema 没有另外改过时，就是由旧版本派生的，会随升级更新。用户强调“其他都别动”而这份数据还被其他页面使用时（dataset_read 的 references），保存前先说明 schema 会随之更新、影响哪些页面，取得同意后再保存；必要时用 catalog_describe 的 schema 视图对比两版。用户只要求保存新版本时，交付精确版本与指纹并询问是否升级哪些页面，不自行改页面。不要用 block.remove 加 component.insert 重传全部 props 来换版本。其他页面保留旧引用。其他组件通过 showai:component/ID 固定依赖旧版本时，需各自发布声明新依赖的版本后，其页面才会用上新版。组件任务完成后继续整体文档任务。交付精确版本与指纹，正式Page通过 [show-document](../show-document/SKILL.md)保存与展示；仅完成组件登记不等于交付了用户页面。

## 模板内组件

模板组件库采用相同的 manifest/schema/source/files/assets 与 versioned documentation。局部 id 在模板内保持简洁，模板保存器自动生成隔离的实际 componentId，并固定版本与指纹。不要手工猜生成名称或重新注册同一份代码；从 template_context 取得本轮绑定并查询相应 guide/parameters。新增图形或交互能力仍由实际理解缺口决定。

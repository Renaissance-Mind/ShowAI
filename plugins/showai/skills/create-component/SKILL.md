---
name: create-component
description: 通过 ShowAI MCP 创建或改造可复用 React 组件。先查目录和评估组合，再补齐确实缺少的图形、表达或交互能力。
---

沿用已核实MCP连接、项目和页面；缺少时读 [use-showai](../use-showai/SKILL.md)。正式资源保存到目标项目；用户明确独立交付时可把相同源码对象交给render_document，不自动创建个人项目。

用[表达与分镜](../design-presentation/references/expression-and-storyboard.md)明确图形关系、状态与通过条件。组件负责稳定的数据表达和交互，实例保存本次事实；通用、专题和内容专用的复用边界分别判断。usage 的 purpose/structure/constraints 说明理解任务、视觉编码、空态、窄屏与静态方式，interactions 说明操作和保存边界；继续使用当前 documentation schema，不添加未经支持的参数。跨组件联动先核实实际接口，只有具体复用需求成立时才提炼共享能力。

先明确内容输入、读者操作及可见结果。先取得或复用project_context的componentCatalog；目录变化时用catalog_list更新。catalog_describe按需取guide/schema/examples；调整数据或组合即可达到目标时复用。需要新实现时读取 [组件设计](references/component-authoring.md)及guide({topic:"component"})。读取详情或源码时沿用目录或页面引用中的scope、version、integrity，准确区分同名组件；实现开发先取development，再只取选中组件所需的source文件。

大源码或资源包在保存前读取 showai_capabilities 的 capacities，按 [容量与大文件](../show-document/references/capacity.md) 分别检查源码、原始资源、实例数据和编译输出；文件资源预算不代表编译后的 data URI 代码也能达到同样大小。

本机与远程均调用component_save，参数source包含manifest、schema、source及可选files/assets。manifest含id、name、version、description、scenarios、entry、defaultData、examples；默认数据和例子都需满足schema。新创作还必须提供manifest.documentation：version=1，reuse（kind、boundaries，内容专用还需owner）、usage（用途、结构、输入含义、操作、保存、限制、示例步骤与修改边界）、development（入口、架构、扩展点、不变量与验证）。准确字段读取guide component返回的documentationSchema；recipe.exampleIndex对应真实示例索引。说明与代码随新版本保存；旧版缺项不冒充通用。源码接收data、onChange、readOnly。正式编辑通过onChange返回有效数据；阅读探索使用本地状态。

可以使用React、包内模块、showai:components及明确声明精确依赖的showai:component/ID。新版本不可覆盖旧版本。页面用kind=custom和data={componentId,version,integrity,props}引用保存回执中的精确版本，不把包ID当作内置kind。

先检查宿主已有选中、右键和悬停扩展点，复用操作、菜单容器与定位。阅读控件按其理解任务组织；编辑动作不进入只读导出。具体验证见组件设计参考。

保存编译成功后，把组件放入真实Page，读取源数据、检查图像与实际交互，再重新读取确认保存。仅声明readData不证明计算结果正确；按稳定ID核对原始值与派生值。独立结果用render_document验证传入源码，交付可编辑输入及HTML/source。连接或编译失败时保留材料并报告，不转用CLI或未保存网页假装成功。

组件任务完成后继续整体文档任务。交付精确版本与指纹，正式Page通过 [show-document](../show-document/SKILL.md)保存与展示；仅完成组件登记不等于交付了用户页面。

## 模板内组件

模板组件库采用相同的 manifest/schema/source/files/assets 与 versioned documentation。局部 id 在模板内保持简洁，模板保存器自动生成隔离的实际 componentId，并固定版本与指纹。不要手工猜生成名称或重新注册同一份代码；从 template_context 取得本轮绑定并查询相应 guide/schema。新增图形或交互能力仍由实际理解缺口决定。

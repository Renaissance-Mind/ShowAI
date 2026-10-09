---
name: create-component
description: 通过 ShowAI MCP 创建或改造可复用 React 组件。先查目录和评估组合，再补齐确实缺少的图形、表达或交互能力。
---

沿用已核实MCP连接、项目和页面；缺少时读 [use-showai](../use-showai/SKILL.md)。正式资源保存到目标项目；用户明确独立交付时可把相同源码对象交给render_document，不自动创建个人项目。

先明确内容输入、读者操作及可见结果。catalog_list查摘要，catalog_describe按需取guide/schema/examples；调整数据或组合即可达到目标时复用。需要新实现时读取 [组件设计](references/component-authoring.md)及guide({topic:"component"})。修改现有组件前只取选中组件的source。

本机与远程均调用component_save，参数source包含manifest、schema、source及可选files/assets。manifest含id、name、version、description、scenarios、entry、defaultData、examples；默认数据和例子都需满足schema。源码接收data、onChange、readOnly。正式编辑通过onChange返回有效数据；阅读探索使用本地状态。

可以使用React、包内模块、showai:components及明确声明精确依赖的showai:component/ID。新版本不可覆盖旧版本。页面用kind=custom和data={componentId,version,integrity,props}引用保存回执中的精确版本，不把包ID当作内置kind。

先检查宿主已有选中、右键和悬停扩展点，复用操作、菜单容器与定位。阅读控件按其理解任务组织；编辑动作不进入只读导出。具体验证见组件设计参考。

保存编译成功后，把组件放入真实Page，读取源数据、检查图像与实际交互，再重新读取确认保存。仅声明readData不证明计算结果正确；按稳定ID核对原始值与派生值。独立结果用render_document验证传入源码，交付可编辑输入及HTML/source。连接或编译失败时保留材料并报告，不转用CLI或未保存网页假装成功。

组件任务完成后继续整体文档任务。交付精确版本与指纹，正式Page通过 [show-document](../show-document/SKILL.md)保存与展示；仅完成组件登记不等于交付了用户页面。

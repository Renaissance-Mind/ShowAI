---
name: create-component
description: 为 ShowAI 创建或改造可复用 React 组件。用户要求新组件，或页面所需表达与交互经目录查找和组合评估后仍存在缺口时使用。
---

沿用已验证的 CLI 或 MCP；首次使用读取 [统一使用指南](../use-showai/SKILL.md) 与 [跨宿主接入](../use-showai/references/integration.md)。独立展示可定制公共组件并交付源码包，无需同步或个人项目；要长期登记复用时，采用用户指定的本地或已授权项目。

MCP 通过 public_catalog_describe 的 source 查看公共源码，项目资源使用 catalog_describe。用 component_save.source 登记项目版本，或把同一源码对象放入 render_document.componentSources 独立渲染。远程工具不接受本机目录，传 manifest、schema、source、files/assets。CLI 沿用下述目录导入流程。无 inline 时交付源码/HTML或项目回执，不因显示能力缺失跳过已授权开发。

先明确内容输入、读者操作和变化后的结果。查询 `catalog list --kind component --query 用途 --limit 8`，选中后取 `guide` / `schema` / `examples`。数据调整即可解决时复用；已有元素组合即可解决时使用 `showai:components` 或声明精确子组件引用。只有需要新的表达或交互实现时才编写组件。

进入开发时读取 [组件设计与验证](references/component-authoring.md)，并查询 `guide component --json`。基于已有组件改造时，只读取选中组件需要的源码文件。新组件同时定义 manifest、输入 schema、默认数据、命名示例和本地 React 入口；组件表达应由 props 驱动，避免把本次页面的事实写死在代码中。

新增或修改交互时，先检查组件与宿主已有的选中、右键、悬停菜单和设置入口，优先将新动作组合到相应的现有菜单中。按实际复用需求提取共享动作、容器、定位逻辑或局部 hook；抽象方式与范围随当前组件决定。菜单位置、动作顺序、选区保持与读取态边界见组件设计参考。

项目登记路径在当前项目导入编译并验证保存与导出；独立路径通过 render_document 编译传入的 componentSources，交付源码包及实际预览/文件，无需追加项目登记。两条路径均在实际页面里验证输入与操作。用页面图像核对效果，在阅读器中实际操作主要交互；涉及工作台编辑行为时再检查对应工作台。交付精确版本与指纹，整体任务包含页面创作或展示时继续按 [show-document](../show-document/SKILL.md) 完成。修改已有组件产生新版本；用户要求复用到其他项目时再查询 `guide versions`。

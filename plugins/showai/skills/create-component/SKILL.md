---
name: create-component
description: 为 ShowAI 创建或改造可复用 React 组件。用户要求新组件，或页面所需表达与交互经目录查找和组合评估后仍存在缺口时使用。
---

沿用已验证的 ShowAI CLI 与当前项目；首次使用读取 [运行入口](../show-document/references/runtime.md)。

先明确内容输入、读者操作和变化后的结果。查询 `catalog list --kind component --query 用途 --limit 8`，选中后取 `guide` / `schema` / `examples`。数据调整即可解决时复用；已有元素组合即可解决时使用 `showai:components` 或声明精确子组件引用。只有需要新的表达或交互实现时才编写组件。

进入开发时读取 [组件设计与验证](references/component-authoring.md)，并查询 `guide component --json`。基于已有组件改造时，只读取选中组件需要的源码文件。新组件同时定义 manifest、输入 schema、默认数据、命名示例和本地 React 入口；组件表达应由 props 驱动，避免把本次页面的事实写死在代码中。

在当前项目导入并编译，放进真实页面验证输入、操作、保存与导出。编译成功只是程序可执行；还要在桌面或交付页面中检查效果和主要交互。交付精确版本与指纹，再回到页面创作。修改已有组件产生新版本；用户要求复用到其他项目时再查询 `guide versions`。

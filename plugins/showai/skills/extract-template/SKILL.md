---
name: extract-template
description: 用户明确要求把迭代成熟的 ShowAI 页面抽象为可复用模板时使用，保留原页面并提取内容结构、填写约定和组件组合。普通页面创作或应用已有模板不触发。
---

沿用已验证的外部 CLI 与用户选定的项目、页面；首次使用读取 [运行入口](../show-document/references/runtime.md)。查询 `guide template-extraction --json`，读取页面当前内容与 hash，并与上次读取版本比较，纳入用户手动修改。

读取 [模板抽象](references/template-abstraction.md)。先识别页面适用的问题、读者和内容组织，区分稳定结构、可替换数据与可选段落。查询同类模板摘要，避免保存一个只换标题的重复版本。目录 guide/examples 用于比较；只有复用或合成需要时读取所选模板源码。

生成模板定义：保留有效布局和组件组合，把实例事实替换为填写提示或空数据状态，将内容要求写入 contentGuide，补上适用场景、相关组件和命名示例。使用当前 CLI 支持的 document/composition 定义；提示由 Agent 填写，不虚构运行时变量替换机制。模板保存在当前项目，原页面继续作为成熟实例保留。

用 `template save --input` 保存，应用到一个新页面，以不同内容验证结构可复用且组件依赖完整。展示模板名称、适用场景与应用结果。全局提升或远端发布仅在用户要求时进行。

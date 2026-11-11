# 扩展点

ShowAI 的工作台提供几个可以填入的位置。宿主负责界面、排序、保存、撤销和导出；填入的一方只声明自己提供什么。内置组件和导入器与 Agent 新做的组件、导入器用同一种声明，所以新增一项不需要改动 App。

`catalog_list({projectId, kind:"contribution"})` 一次列出全部位置：每一项给出宿主提供什么（harness）、填入者声明什么（declare）、详细说明所在的 guide 主题，以及本项目里已经填入的内置组件、库组件和导入器（filledBy）。加 `query` 只看名称、命令或选项匹配的条目。新增之前先查一遍，已有组件能满足时直接复用。

| 位置 | 宿主提供 | 填入者声明 | 详细说明 |
| --- | --- | --- | --- |
| 快速跳转命令（⌘K / Ctrl+K） | 输入框、排序、分组、键盘操作，以及页面、项目和工作台命令 | 组件 manifest 的 `contributes.commands`：插入这个组件，或打开一个页面 | [工作台位置](../../create-component/references/contributions.md#commands快速跳转命令) |
| 正文 @ 菜单 | @ 菜单、页面链接、行内组件节点及其保存、Markdown 与导出 | 组件 manifest 的 `contributes.mention`：菜单填写哪个参数、怎样输入 | [工作台位置](../../create-component/references/contributions.md#mention放进一行文字的组件) |
| 数据库字段类型 | 列设置、筛选、排序、视图、导出，以及在沙箱里运行单元格 | 组件 manifest 的 `contributes.databaseField` 与入口的 `field` 导出 | [数据库字段类型](../../create-component/references/database-field.md) |
| 页面目录 | 目录的位置、收起和目标校验 | 组件 manifest 的 `role:"page-outline"` 与 `pageOutlineProtocol:1` | [组件设计](../../create-component/references/component-authoring.md#page-原生目录组件) |
| 导入器 | 读取文件、文件夹和 zip，生成计划、确认、写入、撤销和报告 | 一个导入器文件夹：`importer.json` 与 `importer.js`。`catalog_version({action:"importer"})` 保存到当前项目；整个内容库共用时由用户在终端运行 `showai importers save 文件夹 --scope global` | [导入与导入器](import.md) |

组件填入的三个工作台位置共用 manifest 的 `contributes` 一节，保存时一起检查，错误写成 `contributes.<路径> <问题>`。导入器不是组件：它不渲染内容，只把另一种格式转成页面和共享数据，所以作为独立的包保存。

组件读取页面之间的引用（manifest 顶层的 `pageReferences: true`）和参数契约里的页面链接规则（`{kind:"page", path}`）说明组件自己用到或保存了什么数据，不属于这些位置；做法见 [组件设计](../../create-component/references/component-authoring.md#读取页面之间的引用) 与 [参数契约](../../create-component/references/parameter-contract.md)。

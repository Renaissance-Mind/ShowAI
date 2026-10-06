---
name: show-document
description: 用 ShowAI 创建、修改或导出交互页面、报告和小型网站。复用已有组件与模板；组件开发和从成熟页面提取模板由专门技能处理。
---

ShowAI 将内容组织成可阅读、可探索的页面。工作台与 Agent 使用同一份项目文件；组件负责表达，模板负责内容组织。先明确读者需要理解什么，再选择布局与交互，使用用户材料或可核实的数据。

插件只分发技能。沿用本会话已验证的 ShowAI CLI 命令前缀与内容目录；首次使用时读取 [运行入口](references/runtime.md)。下文 `showai` 代表该外部命令前缀。

先检查本会话已有的项目绑定：

```sh
showai projects current --harness HOST --session ACTUAL_SESSION_ID --json
```

有绑定就使用返回的项目；用户指定其他项目时先 `projects list --json`，明确选择后绑定。没有绑定时，新建项目：

```sh
showai projects create --name "主题" --harness HOST --session ACTUAL_SESSION_ID --json
showai pages list --project PROJECT --json
```

使用宿主提供的真实会话 id；无法获得时省略绑定，保留新项目 id。每次写入明确指定项目。默认内容库为 `~/.showai`，用 `--home` 与桌面设置保持一致。

按本次操作读取 CLI 指南，普通创作先使用 `guide authoring`；构造 Page 结构时读取 `guide whiteboard`，区域内部的富文本区块再读 `guide document`。

- `guide workspace`：项目与绑定。
- `guide authoring`：读取、差异、编辑和冲突处理。
- `guide whiteboard`：平等区域、布局、视图和旧页迁移。
- `guide catalog`：摘要搜索，再按需查看用途、输入、示例或源码。
- `guide export`：单 HTML、会话展示和网站。

新 Page 默认使用版本 2 白板模型。按表达需要选择区域内的纵向、网格或自由布局，保留已有节点 ID。调整位置使用 layout，指定网页阅读顺序使用 views.readingOrder。模板可建立新页面或加入现有页面；导出用 spatial 保留白板，用 reading 呈现响应式阅读顺序，两者均保存完整可编辑源。

先按用途搜索组件或模板摘要，限制结果数；选中后取 `--view guide`，准备填入数据时取 `schema`，需要参考用法时取 `examples`。普通页面创作无需读取组件源码或整个目录。修改已有页面前读取当前版本、查看差异，并使用当前 hash 保存。

已有组件能够表达内容时直接复用。通过调整数据或组合已有组件能实现需求时采用组合；需要可复用的新交互、图形或布局时，进入 [create-component](../create-component/SKILL.md)，完成后回到页面创作。选库失败本身并不意味着必须写组件，先判断普通文本、表格和既有组件的组合是否足够。

用户明确要求把迭代成熟的页面保存为可复用模板时，进入 [extract-template](../extract-template/SKILL.md)。应用已有模板仍属于本技能，使用 `guide templates` 与所选模板的 `guide`；页面完成不会自动触发模板提取。

交付时使用宿主支持的页面展示通道；文件与网址也是有效交付。完整工作台管理界面不进入读者收到的页面。

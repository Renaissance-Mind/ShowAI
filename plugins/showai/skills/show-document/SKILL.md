---
name: show-document
description: Use ShowAI to create or revise interactive pages, reports and small sites with reusable components and templates, shared with the desktop workspace.
---

ShowAI 将内容组织成可阅读、可探索的页面。工作台与 Agent 使用同一份项目文件；组件负责表达，模板负责内容组织。先明确读者需要理解什么，再选择布局与交互，使用用户材料或可核实的数据。

以下 `showai` 指 `node <本插件根目录>/scripts/cli.mjs`，不要假设全局命令已安装。插件根目录位于当前 skill 目录上两级；独立运行需要 Node.js 22.12+。

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

按当前步骤查询一个主题，无须先读完整参考文档：

- `guide workspace`：项目与绑定。
- `guide authoring`：读取、差异、编辑和冲突处理。
- `guide catalog`：摘要搜索，再按需查看用途、输入、示例或源码。
- `guide templates`：模板内容组织与组合。
- `guide versions`：项目内派生、合并与显式提升到全局。
- `guide export`：单 HTML、会话展示和网站。
- `guide publish`：准备发布文件，以及验证、登记远端版本。

先用 query 与较小 limit 搜索，再 describe 选中的组件或模板。按项目→全局→已发布查找，内置内容兜底；只取下一步需要的 view，源码显式请求。页面和组合引用锁定 version+integrity；已有版本固定，后续编辑形成当前项目的派生版本。全局提升、发布登记均为独立操作；导出不代表已上传。页面修改前检查用户的新编辑并使用当前 hash，遇冲突先合并。

交付时使用宿主支持的页面展示通道；文件与网址也是有效交付。完整工作台管理界面不进入读者收到的页面。

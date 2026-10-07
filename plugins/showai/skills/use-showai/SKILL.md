---
name: use-showai
description: ShowAI 的统一使用指南。首次使用、询问基础用法、查找或阅读已有项目与页面、查看历史，或需要判断页面展示、组件开发、模板创建该用哪个 Skill 时使用。说明软件入口、内容归属和任务路径；具体页面创作与展示交给 show-document。
---

# 使用 ShowAI

ShowAI 提供保存在本机内容库中的项目、可编辑页面、可复用组件和模板。Agent 通过独立软件提供的 CLI 操作内容，用户通过工作台使用同一份内容。插件提供使用说明；安装插件后仍需要可执行的 ShowAI 软件。

首次实际使用 ShowAI，先读本指南建立基础关系，再按当前任务选择专门 Skill。已理解这些关系且保留了可信运行入口与对象身份时，直接继续对应任务。用户直接调用专门 Skill 时，可以从其链接进入本指南补齐缺失信息，无需依次读取所有 Skills。仅解释 ShowAI 用法时，先依据本指南回答；询问本机安装状态或实际内容时再查询软件。

## 内容与运行的基础关系

| 对象 | 含义与用途 |
| --- | --- |
| 内容库 home | 软件实际读写的目录，包含项目和相关资源。默认是 `~/.showai`；用户选择其他库时，以启动配置和实际查询结果为准。代码仓库目录与内容库是两个不同位置。 |
| 项目 Project | 页面及项目资源的归属。同一宿主项目目录可以对应一个 ShowAI 项目，不同会话可共用它。项目 ID 来自查询结果。 |
| 页面资源 | 保留内容身份和版本的编辑对象。Page 适合顺序阅读，Board 适合空间布局，两种容器可在同一资源内嵌套。普通报告默认一份 Page。 |
| 页面节点 | 页面内的文字、组件、区域和嵌套容器，具有稳定 ID。局部读取、编辑与展示使用这些 ID；组件实例 ID 与组件目录条目 ID 用途不同。 |
| 组件 Component | 根据输入数据表达内容或提供交互的可复用实现。页面引用具体组件版本；改变数据通常无需开发新组件。 |
| 模板 Template | 可复用的内容结构、组件组合和填写约定。应用模板创建页面属于页面任务，建立模板本身属于模板任务。 |
| 阅读与导出结果 | 同一源页面的 JSON、Markdown、图像或 HTML 视图。预览里的临时操作不会自动保存为正式内容；导出文件也不会自动上传或出现在用户对话中。 |

宿主提供用户请求、工作目录、工具和展示能力。Skills 说明如何决策，CLI 返回实际内容与能力。页面身份、内容库路径、组件版本、hash 和 revision 应来自用户明确提供的信息或软件结果，不能由会话名称或文档示例推断。

## 按任务选择 Skill 与指南

下表的 `guide TOPIC` 由当前 ShowAI 软件返回。`showai` 表示已核实的外部命令前缀，取得方法见下一节；大写参数需要替换成实际值。

| 当前任务 | 读取哪些 Skill 或参考 | 接下来做什么，完成到哪里 |
| --- | --- | --- |
| 了解 ShowAI，判断是否适合当前任务 | 本指南 | 说明内容模型、可用路径和使用前提。用户只要解释或普通文字回答时，按其要求交付；需要 ShowAI 持久页面、已有内容或可复用资源时进入相应路径。 |
| 找项目、找页面、搜索已有材料并分析 | 本指南；`guide workspace`、`guide reading`；全文搜索按需读 `guide history` | 查询现有项目与页面，读取相关内容并回答。对象定位和读取步骤见下文；用户只要求阅读时，到阅读结果结束。 |
| 阅读正文、提取表格或组件数据 | 本指南；[读取视图](../show-document/references/page-reading.md)、`guide reading` | 默认结构化 JSON 或 Markdown；长页先 outline，再按节点 ID 取局部。需要组件计算数据时检查返回的 computed；只需源结构时可用 `--rendered false`。 |
| 查看已有页面的颜色、布局、溢出或交互 | 本指南；[读取视图](../show-document/references/page-reading.md)、`guide reading` | 布局读 image，操作读 html/actions；保留检查版本和状态。若还要把页面呈现给用户，再读 show-document 的展示流程。 |
| 创建报告、交互页面、网站；修改原页面；应用已有模板 | [show-document](../show-document/SKILL.md) | 按材料组织页面、复用组件、受控写入，再验收并展示。创建结构按需读 containers/document；应用模板按需读 templates 和所选模板 guide。 |
| 展示、导出整页或选定区域；交付 HTML 或项目网站 | [show-document](../show-document/SKILL.md)；其[对话展示](../show-document/references/conversation-display.md)；`guide export` | 选择源页面及节点，生成所需格式，执行宿主实际呈现流程。已有页面可直接导出；展示任务无需重建页面。 |
| 查询有哪些组件或模板、了解怎样填写 | 本指南；`guide catalog` | `catalog list` 查摘要，选中对象后查 guide；准备输入时查 schema，需要例子时查 examples。查询完成即可回答，应用到页面时进入 show-document。 |
| 创建或改造可复用组件 | [create-component](../create-component/SKILL.md)；`guide component` | 先评估已有组件、数据调整和组合。确需新实现时编写、导入、编译并在真实页面中验证；需要页面交付时回到 show-document。 |
| 新建、修改模板，或从成熟页面提炼模板 | [create-template](../create-template/SKILL.md)；`guide templates` | 有材料时先做实例再提炼，结构明确时可直接建模板。交付模板、填写提示和应用验证页面；需要新组件时按需进入 create-component。 |
| 查看谁改了什么、比较版本、处理冲突或恢复页面 | 本指南；`guide history`，涉及编辑再读 `guide authoring` | 查询与比较使用真实 revision；恢复会创建新记录，按用户要求执行。重新读当前页面后再写入，保留草稿和已有修改。 |
| 将组件或模板复用到其他项目、合并资源版本或发布 | 当前对象对应的专门 Skill；`guide versions` / `guide publish` | 在用户要求的范围内处理版本、提升或发布。项目内保存和 HTML 导出本身不触发共享或发布。 |
| 排查 ShowAI 编辑器、桌面窗口或原生行为 | 本指南；相关开发与测试规则 | 检查用户指定的实际软件界面。页面正文阅读、页面布局检查和阅读器交互验证分别使用上面的读取路径。 |

## 何时取得运行入口

决定调用 ShowAI 后，检查是否已经知道可执行命令、参数、环境和内容库。缺少这些信息时读取 [运行入口与内容库](references/runtime.md)：它说明如何从用户配置或软件登记文件取得入口，如何调用，以及失败时缺少什么。目标项目不明确但运行入口已知时，直接进入对象定位。

初次取得入口后执行 `runtime info --json`，确认软件能运行、实际 home 正确、所需指南和能力存在，保存返回信息。后续复用已核实入口；软件入口或内容库变更、调用失败、或操作依赖尚未核实的能力时，重新核对相应信息。插件说明更新不会更新软件。

CLI 单次执行后退出；通常无需启动工作台窗口或常驻服务。若入口不存在，说明实际缺项，并使用宿主或用户提供的连接配置；不要通过桌面寻找页面来替代未建立的软件连接。

## 定位项目与页面

先采用用户指定的项目或页面归属。已有可信 `home + projectId + pageId` 时，直接读取对象核对；只有名称或关键词时，通过列表或搜索取得 ID：

```sh
showai projects list --json
showai pages list --project PROJECT --json
showai search --query "关键词" --project PROJECT --kind page --limit 8 --json
```

`projects list` 返回项目摘要，可核对名称、ID 与目录信息；`pages list` 返回该项目页面；search 返回匹配项，再按对应页面 ID 读取。全文搜索要求版本化内容库，先核对 storage 与 `guide history`。多个对象符合请求且不能据上下文确定时，询问缺少的归属信息。纯阅读查找使用现有对象，并显式传入项目 ID。

创作任务未指定 ShowAI 项目时，根据可信宿主工作目录定位：

```sh
showai projects current --source-directory /absolute/host-project --json
```

宿主未提供独立项目目录、当前工作目录确实是任务目录时，可执行 `projects current --json`。它从 cwd 查找 Git 根目录，没有 Git 则使用 cwd；首次映射会自动创建项目。返回 `home`、`project.id`、`sourceDirectory`、`resolution`、`created`。先核对归属，再沿用返回的项目 ID。查询示例不能照搬插件目录、软件源码目录或输出目录作为用户项目目录。

用户要求独立项目时才显式 `projects create --name "项目名" --json`。同目录不同会话共用项目；session ID 用于来源记录，不决定默认目标，也不能唯一确定页面。

## 读取、修改与结果核实

已取得页面 ID 后，根据任务读取：

```sh
showai guide reading --json
showai pages read PAGE --project PROJECT --detail outline --json
showai pages read PAGE --project PROJECT --blocks NODE_ID --format markdown
showai pages read PAGE --project PROJECT --json
```

outline 用于找到节点，局部读取用于减少无关内容，完整读取用于取得正式编辑的源数据与当前版本。JSON 成功结果封装在 `{ "ok": true, "data": ... }`；失败结果包含 error 且进程退出码非零。先检查执行结果再使用 data。局部视图、图像、HTML 和组件计算值各有用途，正式修改使用完整源页面的 hash、revision 和稳定节点 ID。

页面写入、组件开发与模板建立按对应 Skill 完成。版本化内容库的页面写入同时传当前 `--base-hash` 和 `--base-revision`；冲突时重新读取、比较并合并。命令成功证明本次操作完成；正文修改需要核对内容，视觉修改需要检查图像，交互修改需要实际操作阅读器。读取视图中的 draft 修改仍需正式写入。

## 交付与后续任务

阅读与分析任务交付答案及必要来源；页面创建、修改和展示按 show-document 执行保存、导出与宿主呈现。用户只保存、只要文件或后台执行时采用其指定方式。专门技能完成后继续完成已授权的整体任务，例如创建组件后应用到用户页面。

在当前会话保留实际 home、启动入口、projectId、pageId、完整页面 hash/revision，以及本轮修改或展示的节点 ID；版本可变化，下一次编辑重新读当前状态。新会话通过用户提供的页面身份或项目内查找恢复目标。多个候选页面时核对选择，不把会话绑定当页面身份。真实宿主来源可用时记录它，无法取得时明确为未知。

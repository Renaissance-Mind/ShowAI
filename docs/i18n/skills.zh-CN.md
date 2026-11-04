# ShowAI 技能与使用路径

**语言：** [English](../skills.md) | 简体中文 · [文档目录](index.zh-CN.md)

ShowAI 插件提供六个 Skill，覆盖总入口与内容管理、对话展示、作品创作、模板、组件和画布协作。运行时提供存储、原生容器、目录、编译与渲染；Plugin 分发技能、指南与连接配置。CLI 用于启动、诊断与脚本，Agent 的文档操作统一使用 MCP。

| Skill                                                                         | 何时使用                                               | 产物                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| [use-showai](../../plugins/showai/skills/use-showai/SKILL.md)                 | 总入口：按用户要的结果分流；连接、查找、阅读与管理内容 | 连接与项目身份、整理结果和下一步使用的 Skill |
| [show-visual](../../plugins/showai/skills/show-visual/SKILL.md)               | 在对话中直接展示可视化                                 | 展示 1–5 个组件，不保存                      |
| [show-document](../../plugins/showai/skills/show-document/SKILL.md)           | 创作或修改作品：报告、讲解页面、白板图示与小型网站     | 工作记录、可继续编辑的 Page 与实际交付       |
| [create-template](../../plugins/showai/skills/create-template/SKILL.md)       | 为某一类内容建立或提炼模板                             | 模板文件夹、指南与应用验证                   |
| [create-component](../../plugins/showai/skills/create-component/SKILL.md)     | 既有数据调整和组合无法满足表达需求                     | 精确版本的组件、契约与真实页面实例           |
| [collaborate-canvas](../../plugins/showai/skills/collaborate-canvas/SKILL.md) | 多端配对、边写边画与位置参考                           | 明确保存边界的协作画布                       |

## 从用户任务开始

use-showai 是唯一的入口，按用户要的结果分流：创作或修改作品进入 show-document；只在对话里看组件、不保存，进入 show-visual；查找、阅读和管理已有内容留在 use-showai 及其参考文档；组件、模板和画布协作各有对应的 Skill。连接与项目归属、内容模型和保存规则也写在 use-showai 中。用户无需手动逐个调用 Skill。

简单问题直接回答；普通修改完成对应局部工作。创作或修改作品时，Agent 在开头一次读完 show-document：它包含完整的制作流程、每个环节怎样用 ShowAI 完成、工作记录、模板使用、制作与交付。已有记录直接沿用，不需要每个环节都重新确认。

用户只要规划或设计稿时，做到相应环节为止，交付这份记录。用户要成品时继续完成制作、评审、保存与展示。用户说“这里看不懂”时，先读取完整原作品，定位事实、先备概念、主线、图形或交互问题，连贯修改受影响的正文与图示。

共享方法见 [show-document](../../plugins/showai/skills/show-document/SKILL.md)。不同分支可有不同解释深度；概念关系、阅读顺序和屏幕展开分别设计。重要结论条件直接可见，补充材料可按需展开。

## 连接与内容归属

首次调用 guide() 读取共享入口，再调用 showai_capabilities，再用 project_context 或 projects_list 核对连接与归属。本机 library 连接中新正式内容可以用 project_resolve 解析可信宿主目录；只读查询不创建项目。远程只使用授权返回的项目身份。页面修改保留当前 hash、revision 与稳定节点 ID，保存冲突明确处理。

正式成果先保存到项目，再调用 page_present。独立文件或不入库交付需要用户明确选择。连接、保存或展示失败时保留材料并报告实际限制，不改用另一内容库、创作 CLI 或未保存网页代替。

## 模板与组件

模板复用某一类内容的呈现方法，组件复用数据表达与交互能力，本次事实保存在 Page 实例中。先选择适合理解任务的表达，再查当前目录；使用精确版本的 guide/schema 准备输入，开发实现时才读取 development 和必要源码。

系统呈现规则必须遵循，分七个环节：理解意图（读者简报）、收集材料（材料底稿）、呈现逻辑（多级呈现规划）、设计稿（逐幕设计稿）、制作、评审（评审记录）与交付。制作按设计稿落实，交付展示已保存的 Page。运行时内置 `paper-explainer` 论文讲解方法模板与空白页；按阶段组织的旧模板继续可读。选用组件的判断写在 [show-document](../../plugins/showai/skills/show-document/SKILL.md) 设计稿环节的“组件与素材”中。

Agent 把每份作品的记录写进一个文件夹 `<YYYYMMDD-HHmm>-<作品短名>-<8 位随机十六进制>/`，位于 `showai_capabilities.authoring.workRecords` 返回的记录目录下，包含 `brief.md`、`material.md`、`presentation-plan.json` 和 `review.md`。记录目录默认是系统临时目录下的 `showai-records`，可以在 App「设置 → 通用」中修改，也可以用环境变量 `SHOWAI_RECORDS_DIR` 固定。续改时沿用写有该页面 ID 的记录文件夹。没有文件系统的远程连接把记录写在对话里。

新模板使用[模板文件夹](template-bundles.zh-CN.md)：README、按阅读顺序排列的指南和可选组件库。模板只补充这类内容的方法，不重复制作流程；选用后 Agent 用 template_context 一次读完整个模板，在各环节叠加使用。应用模板创建空白 Page，页面结构来自本次的呈现逻辑与设计稿。旧 document/composition/contentGuide 定义继续可读。模板由 Agent 根据真实材料填写；它不是自动变量绑定系统。缺少材料时保留缺项和结论限制。提炼模板时保留原作品，用不同材料检查适用边界。

组件沿用现有 schema 和版本化 documentation，说明输入、图形语义、状态、保存、窄视口与静态方式。优先调整和组合已有能力；明确缺口才进入组件开发。

## 验证与交付

源数据核对、静态截图、实际操作与读者试读分别提供不同证据。遵循宿主规定的界面操控方式。内容、来源、主线、可读性、交互和恢复都按任务检查；静态版本保留重要状态、条件和来源。没有实际检查的范围应明确说明。

完整 Page 保存后，page_present 返回全页 HTML/source 及可选的局部聊天预览。聊天容量不足时选择可独立理解的节点，并保留全页交付。显示契约见[对话展示](../../plugins/showai/skills/use-showai/references/host-display.md)。

插件安装、宿主能力刷新和会话获得新说明分别核验。安装插件不自动升级运行时；更新后检查实际 Skill 列表、MCP 能力和模板目录。

# ShowAI 技能与使用路径

**语言：** [English](../skills.md) | 简体中文 · [文档目录](index.zh-CN.md)

ShowAI 插件提供八个 Skill，覆盖连接阅读、理解规划、表达设计、页面制作、呈现评审、模板和组件。运行时提供存储、原生容器、目录、编译与渲染；Plugin 分发技能、指南与连接配置。CLI 用于启动、诊断与脚本，Agent 的文档操作统一使用 MCP。

| Skill                                                                           | 何时使用                             | 产物                                       |
| ------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| [use-showai](../../plugins/showai/skills/use-showai/SKILL.md)                   | 基础用法、连接、查找、阅读与能力发现 | 可靠答案、项目和页面身份、当前目录         |
| [plan-presentation](../../plugins/showai/skills/plan-presentation/SKILL.md)     | 先规划怎么讲清楚、复杂内容组织       | 任务简报、证据范围、多级理解路径与通过条件 |
| [design-presentation](../../plugins/showai/skills/design-presentation/SKILL.md) | 视觉、布局、图形与交互分镜           | 设计稿、主要状态、静态方式与资源选择       |
| [show-document](../../plugins/showai/skills/show-document/SKILL.md)             | 制作、续改、展示、导出或应用模板     | 可继续编辑的 Page 与实际交付               |
| [review-presentation](../../plugins/showai/skills/review-presentation/SKILL.md) | 检查效果、诊断难理解处、按目标重做   | 可定位的问题、修订与复核范围               |
| [create-template](../../plugins/showai/skills/create-template/SKILL.md)         | 建立或提炼可重复使用的内容结构       | 模板、填写约定与应用验证                   |
| [create-component](../../plugins/showai/skills/create-component/SKILL.md)       | 既有数据调整和组合无法满足表达需求   | 精确版本的组件、契约与真实页面实例         |
| [collaborate-canvas](../../plugins/showai/skills/collaborate-canvas/SKILL.md)   | 多端配对、边写边画与位置参考         | 明确保存边界的协作画布                     |

## 从用户任务开始

简单问题直接回答；普通修改完成对应局部工作。复杂报告或交互讲解由 show-document 组织规划、设计、制作和评审，已有产物直接复用。用户无需手动逐个调用 Skill，也不需要每个阶段都重新确认。

用户只要规划或设计时，交付相应方案。用户要成品时继续完成制作、验证、保存与展示。用户说“这里看不懂”时，先读取完整原作品，定位事实、先备概念、主线、图形或交互问题，连贯修改受影响的正文与图示。

共享方法见[呈现工作约定](../../plugins/showai/skills/plan-presentation/references/presentation-contract.md)。不同分支可有不同解释深度；概念关系、阅读顺序和屏幕展开分别设计。重要结论条件直接可见，补充材料可按需展开。

## 连接与内容归属

首次调用 guide() 读取共享入口，再调用 showai_capabilities，再用 project_context 或 projects_list 核对连接与归属。本机 library 连接中新正式内容可以用 project_resolve 解析可信宿主目录；只读查询不创建项目。远程只使用授权返回的项目身份。页面修改保留当前 hash、revision 与稳定节点 ID，保存冲突明确处理。

正式成果先保存到项目，再调用 page_present。独立文件或不入库交付需要用户明确选择。连接、保存或展示失败时保留材料并报告实际限制，不改用另一内容库、创作 CLI 或未保存网页代替。

## 模板与组件

模板复用内容结构和填写约定，组件复用数据表达与交互能力，本次事实保存在 Page 实例中。先选择适合理解任务的表达，再查当前目录；使用精确版本的 guide/schema 准备输入，开发实现时才读取 development 和必要源码。

系统基线规定四个阶段，每阶段一份记录：理解意图（读者简报）、收集与处理材料（材料底稿）、呈现逻辑（多级呈现规划）、呈现设计稿（逐幕设计稿）；制作按设计稿落实，评审对照记录检查。运行时内置 `paper-explainer` 论文讲解方法模板与空白页；旧的六阶段模板继续可读。组件候选见[复用选择](../../plugins/showai/skills/design-presentation/references/reuse-selection.md)。

新模板使用[模板文件夹](template-bundles.zh-CN.md)，声明四个阶段的指南与可选组件库；应用模板创建空白 Page，页面结构来自本次的呈现逻辑与设计稿。旧 document/composition/contentGuide 定义继续可读。模板由 Agent 根据真实材料填写；它不是自动变量绑定系统。缺少材料时保留缺项和结论限制。提炼模板时保留原作品，用不同材料检查适用边界。

组件沿用现有 schema 和版本化 documentation，说明输入、图形语义、状态、保存、窄视口与静态方式。优先调整和组合已有能力；明确缺口才进入组件开发。

## 验证与交付

源数据核对、静态截图、实际操作与读者试读分别提供不同证据。遵循宿主规定的界面操控方式。内容、来源、主线、可读性、交互和恢复都按任务检查；静态版本保留重要状态、条件和来源。没有实际检查的范围应明确说明。

完整 Page 保存后，page_present 返回全页 HTML/source 及可选的局部聊天预览。聊天容量不足时选择可独立理解的节点，并保留全页交付。显示契约见[对话展示](../../plugins/showai/skills/show-document/references/conversation-display.md)。

插件安装、宿主能力刷新和会话获得新说明分别核验。安装插件不自动升级运行时；更新后检查实际 Skill 列表、MCP 能力和模板目录。

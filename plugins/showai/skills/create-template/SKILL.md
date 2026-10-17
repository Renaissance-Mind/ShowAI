---
name: create-template
description: 创建、修改或提炼可复用的模板文件夹：严格 README 元信息、理解意图/收集材料/呈现逻辑/呈现设计稿四个阶段的指南和可选组件库。模板创作请求使用；普通页面应用模板由 show-document 完成。
---

# 创建模板包

模板为某一类内容保存可复用的呈现方法：读者通常是谁、要什么；该类材料怎样采集与核对；哪些主干与可选环节在不同材料中仍然成立；哪些画面设计已被验证有效、对应哪些组件。它不是页面骨架，也不是填空表；应用模板得到空白 Page，页面结构由本次的呈现逻辑与设计稿决定。

先查 `catalog_list({kind:"template",projectId})` 是否已有覆盖该场景的模板（内置或项目/全局）：已有则以新版本修改它，没有才新建。沿 [show-document](../show-document/SKILL.md) 的系统基线确定重复的读者任务、输入材料、产出和通过条件。template_save 保存到当前项目；提升为全局模板是宿主管理操作，用户要求跨项目使用时说明这一步。用户有成熟实例时先验证实例，再按 [实例提炼](references/template-abstraction.md) 创建；结构已明确时按 [直接创建](references/template-creation.md) 继续。只询问会改变结构的缺项，信息充分时完成可使用的包及真实应用验证。

先读 guide({topic:"templates"}) 的当前格式。模板是一个文件夹：README.md 的严格 JSON frontmatter 加简短基础说明；guides/ 的四阶段 Markdown 或阶段子目录；components/ 的可选组件包。元信息包含 format、schemaVersion（当前为 3）、id、name、version、description、scenarios、guides、components。guides 必须声明 intent、material、logic、design 四个阶段，null 表示继承系统指南；阶段目录的主文件是 README.md，其他 Markdown 作为按需细节。系统模板由运行时提供，项目模板不能替换或关闭它。内置的 `paper-explainer` 是完整示例，用 template_context 与 template_guide 读取它的 README 与四份指南作为参照。

各阶段指南写什么：intent 写该类内容的默认读者、常见深层需求、容易误解的点和可检验目标；material 写采集清单与核对方式（通用场景可为 null）；logic 写在不同材料中仍成立的主干、可选环节、每个环节要讲清的内容与组织原则；design 写每幕已验证的画面（composition 起点）、文字模式、交互、组件对应与内置替代。指南是方法与判断标准，不复制系统基线，也不为填满目录增加无意义内容。

模板组件沿 [create-component](../create-component/SKILL.md) 的 source/schema/documentation 规范。README 声明本地 id/path，manifest.id 与本地 id 一致；注册时自动加模板命名空间，页面与后续查询使用回执中的精确引用。本地组件依赖声明本地 id/version；外部依赖仍需精确指纹。组件代码改变时升级组件版本，指南或包结构改变时升级模板版本。design 指南用本地名引用组件，并为没有组件库的使用者给出内置替代。

本机和网页 MCP 都用 template_save({projectId,input:{bundle:{format:1,files,assets?}}})。files 以相对路径映射 UTF-8 文本，assets 保存组件图像/字体的 base64；网页端不传本机目录。CLI `template import/export` 属于宿主管理接口。旧的六阶段 schemaVersion 1–2 包仍可读取；明确新建采用 schemaVersion 3。

保存后 template_context 取得固定引用与组件索引，按阶段读 template_guide，用另一份材料走完四个阶段并 template_apply 做真实实例；验证内容、组件、主要操作和导出。原实例保持原样。修改可复用方法发布新版本，本次事实修订只改实例。交付元信息、精确引用、阶段与组件说明、应用 Page 和完整交付文件。

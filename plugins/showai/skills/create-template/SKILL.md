---
name: create-template
description: 创建、修改或提炼可复用的模板文件夹，包含严格 README 元信息、分阶段指南和可选组件库。模板创作请求使用；普通页面应用模板由 show-document 完成。
---

# 创建模板包

沿 [show-document](../show-document/SKILL.md) 的系统基线，明确重复的读者任务、输入材料、产出和通过条件。用户有成熟实例或具体视觉参考时先验证实例，再按 [实例提炼](references/template-abstraction.md) 创建；结构已明确时按 [直接创建](references/template-creation.md) 继续。沿当前模板阶段继续，避免把所有指南重复加载。只询问会改变结构的缺项，信息充分时完成可使用的包及真实应用验证。

先读 guide({topic:"templates"}) 的当前格式。新模板采用一个文件夹：README.md 的严格 JSON frontmatter＋简短基础说明；guides/ 的六阶段 Markdown 或阶段子目录；components/ 的可选自定义组件包；可选 page.json 骨架。scenarios 等元信息只在目录层披露，具体阶段只读对应指南。新模板不作为六个全局 skill 安装。

阶段为 intent、evidence、understanding、design、authoring、review。guides 必须声明全部阶段，null 表示继承系统指南，不用写无意义的重复说明。阶段目录的主文件是 README.md，其他 Markdown 作为按需细节。系统模板由运行时强制提供，项目模板不能替换或关闭它。

模板组件沿 [create-component](../create-component/SKILL.md) 的 source/schema/documentation 规范。README 声明本地 id/path，manifest.id 与本地 id 一致；注册时自动加模板命名空间，页面与后续查询使用回执中的精确引用。本地组件依赖声明本地 id/version，注册器解析和固定；外部依赖仍需精确指纹。组件代码改变时升级组件版本，指南或包结构改变时升级模板版本。

本机和网页 MCP 都用 template_save({projectId,input:{bundle:{format:1,files,assets?}}})。files 以相对路径映射 UTF-8 文本，assets 保存组件图像/字体的 base64；网页端不传本机目录。CLI 目录导入/导出属于宿主管理接口，Agent 文档创作继续使用 MCP。旧 document/composition/contentGuide 格式仍可维护；明确新建采用文件夹格式。

optional page.json 使用当前 Page/Board 结构并抽掉实例事实。模板内自定义节点可先引用本地组件 id，注册器重写成固定引用；无 page.json 时应用会创建可继续填入的空页面。填写规则、场景和步骤放在 README/阶段指南，不假定存在自动材料绑定。

保存后 template_context 取得固定引用与组件索引，读当前阶段并用 template_apply 做真实实例；验证内容、组件、主要操作和导出。不同材料检查复用，原实例保持原样。修改可复用结构发布新版本，本次事实修订只改实例。交付元信息、精确引用、阶段与组件说明、应用 Page 和完整交付文件。

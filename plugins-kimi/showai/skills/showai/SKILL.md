---
name: showai
description: 在 Kimi Work 中通过 ShowAI MCP 创建、修改、阅读和展示项目页面。正式内容先保存，再适配当前宿主的 Widget 或文件展示能力。
---

# 在 Kimi Work 使用 ShowAI

Agent使用已连接的ShowAI MCP工具操作文档。宿主负责本机或远程连接配置；没有连接或调用失败时报告具体缺项，不自动启动默认开发服务、不切内容库、不改用创作CLI或未保存HTML。

首次操作调用showai_capabilities，核对连接范围和能力。本机library连接先project_context、projects_list；新正式内容可用project_resolve({sourceDirectory})解析可信宿主项目目录。绑定连接沿用指定项目，远程连接只使用projects_list返回的授权项目。每次项目操作显式传projectId。

纯阅读用pages_list、library_search和page_read，长页先outline再按blockIds读取。不要因为只读查询创建项目。修改前读取完整Page，保留hash、revision和稳定节点ID，page_apply/page_save同时传baseHash/baseRevision。保存冲突必须比较并处理，不能只更新基线覆盖。

页面创建、组件和模板操作分别查询guide的authoring、containers、component、templates等主题。component_save的source对象包含manifest、schema、source及可选files/assets，参数以当前schema为准；模板用template_save/template_apply。正式内容保存在选定项目。只有用户明确要求独立结果时才调用render_document，并说明未保存个人项目。

保存后调用page_present。blockIds只选择inline预览，完整HTML/source仍保留全页。远程操作另核对synchronization状态；展示或本机保存成功不证明远端已同步。

## Kimi 展示适配

若当前宿主提供Widget及其使用说明，按实际契约将delivery.html完整阅读文件用于Widget，并执行宿主的显示动作。更新时复用已有展示入口。局部展示若宿主只接受完整HTML文件，可用可用的page_export获取明确的选区HTML，同时保留page_present的完整交付。

没有Widget能力时交付页面身份与完整HTML文件/下载链接，不伪造显示。不要使用Codex的visualize引用语法，不在正文粘贴整段HTML，不为显示限额拆分正式源Page。用户要求只保存、只交付文件或后台运行时遵循指定。

核对源内容、实际图像与主要交互，区分已保存、已同步、已显示和未验证范围。原始内容与完整历史必须保留。

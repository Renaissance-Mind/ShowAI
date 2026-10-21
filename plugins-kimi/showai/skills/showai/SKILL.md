---
name: showai
description: 在 Kimi Work 中通过 ShowAI MCP 在对话里直接展示组件，或创建、修改、阅读和展示项目页面。只看一眼的可视化不建项目；正式内容先保存，再适配当前宿主的 Widget 或文件展示能力。
---

# 在 Kimi Work 使用 ShowAI

Agent使用已连接的ShowAI MCP工具操作文档。宿主负责本机或远程连接配置；没有连接或调用失败时报告具体缺项，不自动启动默认开发服务、不切内容库、不改用创作CLI或未保存HTML。

首次操作调用showai_capabilities，核对连接范围和能力。本机library连接先project_context、projects_list；新正式内容可用project_resolve({sourceDirectory})解析可信宿主项目目录。绑定连接沿用指定项目，远程连接只使用projects_list返回的授权项目。每次项目操作显式传projectId。

纯阅读用pages_list、library_search和page_read，长页先outline再按blockIds读取。不要因为只读查询创建项目。修改前读取完整Page，保留hash、revision和稳定节点ID，page_apply/page_save同时传baseHash/baseRevision。保存冲突必须比较并处理，不能只更新基线覆盖。

页面创建、组件和模板操作分别查询guide的authoring、containers、component、templates等主题。component_save的source对象包含manifest、schema、source及可选files/assets，参数以当前schema为准；模板用template_save/template_apply。正式内容保存在选定项目。只有用户明确要求独立文件时才调用render_document，并说明未保存个人项目。

## 对话展示

用户只想在对话里看一眼图表、示意、模拟或对比，没有提保存、文档、分享或续改已有页面时，不建项目：读所选组件的guide后调用show_component({kind,data})，或用blocks一次展示最多5个组件，delivery选fragment-file。把返回的delivery.inline文件原样写入Widget的workspace/index.html并执行显示动作；不要用compact或CDN阅读器。组件索引标为conversation:"limited"且说明需要联网的组件（G2图表、外部图形套件、PDF）在本宿主无法离线显示，改选其他组件或用delivery:"image"。正文只写画面要点，并说明没有保存。用户随后要保存时，按下文确定项目，把同一份{kind,data}原样作为page_create的blocks写入，再page_present。

保存后调用page_present。blockIds只选择inline预览，完整HTML/source仍保留全页。远程操作另核对synchronization状态；展示或本机保存成功不证明远端已同步。

## Kimi 展示适配

若当前宿主提供Widget及其使用说明，按实际契约将阅读文件用于Widget，并执行宿主的显示动作。按统一规则选择：完整页面优先导出 format:"inline" 且 components 必须为 bundled——对话宿主拦截一切远程请求，CDN/remote 阅读器（jsDelivr、unpkg 或 ShowAI 阅读器源）在对话内无法渲染，不得作为对话内嵌入口。inline 导出按最终压缩字节判断宿主约 1MB 的体积限制：满足时把导出的 inline 文件原样写入 Widget 的 workspace/index.html 并执行显示动作，作为对话内嵌入口；超出时退化为完整离线文件（format:"html"、bundled，打开不需要联网）交付并附链接，或对明确选区导出 inline blocks，不为显示限额拆散正式源Page。需要直接写出 HTML 时用 delivery.compact。更新时复用已有展示入口。局部展示若宿主只接受完整HTML文件，可用 page_export（format:"html"）获取明确的选区HTML，同时保留page_present的完整交付。

没有Widget能力时交付页面身份与完整HTML文件/下载链接，不伪造显示。不要使用Codex的visualize引用语法，不在正文粘贴整段HTML，不为显示限额拆分正式源Page。用户要求只保存、只交付文件或后台运行时遵循指定。

核对源内容、实际图像与主要交互，区分已保存、已同步、已显示和未验证范围。原始内容与完整历史必须保留。

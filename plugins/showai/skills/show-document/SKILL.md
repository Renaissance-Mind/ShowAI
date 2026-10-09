---
name: show-document
description: 通过 ShowAI MCP 创作、修改、展示或导出页面、报告与小型网站，或应用模板。正式内容先保存 Page，再按宿主能力展示；明确的独立交付可不入库。
---

# 创作与展示文档

先明确读者需要理解什么，依据用户材料与可核实来源组织内容。首次接入或归属不清时读取 [use-showai](../use-showai/SKILL.md)；已有可信 MCP连接与页面身份就继续。正式页面默认保存到所选项目，明确只要独立交付时才使用 `render_document`。保存失败、工具缺失或显示超限不是改为独立文件的理由。

## 正式页面

先调用 `guide({topic:"authoring"})`；构造容器时读 containers，内部正文时读 document。首次选择组件用 `catalog_list({kind:"component",projectId})` 获取全部内置组件与当前项目组件的名字、摘要、场景，省略 scope/query/limit/cursor；选中后沿用返回的 scope/version/integrity 取 guide/schema/examples，准确区分同名组件。已有组件或组合足够时直接复用；存在明确的表达或交互缺口时进入 [create-component](../create-component/SKILL.md)。需要可复用模板时进入 [create-template](../create-template/SKILL.md)；应用已有模板则直接用 template_apply。

普通报告保留一份 Page，用章节、区域和嵌套容器组织。用户要求网站或多个独立文档时才拆分页面。后续修改继续使用原 pageId。新页面用 page_create；修改前 page_read完整源数据，保留 hash、revision与稳定节点 ID，再用 page_apply或page_save。

```json
{"projectId":"已核实项目ID","pageId":"已读取页面ID","baseHash":"读取结果的hash","baseRevision":"读取结果的revision","operations":[{"type":"block.text.set","blockId":"稳定节点ID","text":"修改后的正文"}]}
```

这是 page_apply 的参数形状，具体操作查询当前 guide/inputSchema。不要用局部读取或选区导出覆盖完整页面。CONFLICT时比较原始基线、当前内容与尝试稿后处理，不能只换 hash/revision覆盖。跨设备冲突可能返回新的 document.id，后续使用实际返回值。

## 结构与内容

新资源使用 v3：根和嵌套容器为 `surface`，kind为 page或board。Page按树顺序阅读，Board表达局部空间。`layout`保存父级给子对象的外框，`surfaceViews`保存命名视图与阅读顺序；当前选中、滚动与展开属于个人状态。原生容器保持surface结构，不编码成普通widget。绘画保存在Board中；连接、旋转和变换按需读 [Board 编辑](references/board-authoring.md)。

组件节点使用稳定 attrs.id。自定义组件用 kind=custom，data包含componentId、version、integrity与props。不得把组件包 ID当成内置kind。正文 Markdown支持行内与块级公式，代码块保持原文。视频、音频、PDF与参考文献优先复用内置组件，先查schema。离线交付所需资源必须嵌入；在线资源的网络要求要如实说明。教学示例明确标记，不能冒充实测数据。

## 独立交付

用户明确要求不入库或只要独立文件时，可用公开目录与 `render_document({document或templateId,title?,componentSources?,blockIds?})`。document与templateId二选一；自定义源码对象沿用component_save.source结构。读取persistence回执：独立渲染不创建个人项目，也不进行同步。需要后续正式保存时，再把完整文档与组件保存到明确项目。

## 验证与交付

源内容用page_read核对；布局用image，交互按 [阅读视图](references/page-reading.md)检查，并遵循宿主实际UI操控规则。正式编辑不能由临时预览代替。工具回执、视觉检查和实际操作分别记录；未验证的部分不得称为通过。

正式保存后使用 `page_present({projectId,pageId,blockIds?})`。它返回完整HTML/source与可选inline预览；宿主/运行时决定输出路径。按 [对话展示](references/conversation-display.md)实际显示。支持聊天预览时交付本轮引用；完整文件链接为补充。用户要求只保存、只要文件、面板展示或后台执行时遵循指定形式。

局部展示从完整Page取得真实节点ID；选中容器包含子树。page_present的完整HTML与source保留全页，blockIds只限制inline；不能通过自定义组件内部DOM ID选择页面节点。超限时选择可独立理解的节点重新展示，保留完整源Page。明确请求文件或网站导出时用可用的page_export，核对它的格式、选区与路径约束。宿主不支持显示时交付页面身份、保存/同步结果和可用文件，不自行改写内容归属。

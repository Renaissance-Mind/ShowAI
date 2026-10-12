---
name: show-document
description: 通过 ShowAI MCP 制作可交互的研究报告、讲解页面和小型网站，或续改、展示、导出与应用模板。用户请求完整报告（包括只给报告题目）时使用；普通知识问答不自动制作为页面。
---

# 创作与展示文档

先明确读者需要理解什么，依据用户材料与可核实来源组织内容。首次接入或归属不清时读取 [use-showai](../use-showai/SKILL.md)；已有可信 MCP连接与页面身份就继续。正式页面默认保存到所选项目，明确只要独立交付时才使用 `render_document`。保存失败、工具缺失或显示超限不是改为独立文件的理由。

## 从理解目标到页面

按任务规模使用[呈现工作约定](../plan-presentation/references/presentation-contract.md)。复杂报告、机制讲解或决策页面，先由 [plan-presentation](../plan-presentation/SKILL.md) 明确认知起点、证据范围和多级理解路径，再由 [design-presentation](../design-presentation/SKILL.md) 决定图形、布局、文字与交互分镜；制作前保存并检查规划文件，已有有效材料时直接组装。简单编辑使用相关判断即可，不强制生成额外规划文档。

只提供报告题目时，根据题目和已有场景推断读者与范围并标明假设，直接推进可独立完成的研究和设计。日期未结束时以实际检索日为界。确有多个会改变研究方向的解释时简短澄清；无需为已经合理确定的字号、模板等常规选择等待用户。

用户只要求规划或设计时，按[呈现工作约定](../plan-presentation/references/presentation-contract.md#记录与权限)交付相应产物；正式成果保存并展示，对话讨论直接回答，不继续实现应用或组件。用户要求成品时，规划与设计是同一创作任务的环节，继续完成制作、修订和交付。只读问题沿 use-showai 回答，不自动创建页面。

先按理解任务选择表达，再核对模板和组件。模板填写约定由 Agent 根据真实材料执行；初始占位提示必须替换为本次内容，真实缺项写成明确限制。生成图逐项核对标签、箭头、数量与含义，精确数据保留原始值和来源。重要结论条件默认可见；补充证据可按需展开。正文只呈现读者需要的信息，制作过程记录保存在相应工作材料中。

续改先读取完整原 Page 和用户反馈。定位事实、认知、顺序、表达或交互障碍，连贯修订受影响的标题、图形、图注、正文和来源；保持原作品身份，保留无关修改。反馈融入新正文，不在正文逐条回应修改要求。

完成复杂作品后，按 [review-presentation](../review-presentation/SKILL.md) 将最终分镜映射到保存的源页面并核对语义，保留前置规划及后续修订。

## 正式页面

先取得或复用 project_context 的 componentCatalog，再调用 `guide({topic:"authoring"})`；构造容器时读 containers，内部正文时读 document。上下文尚未提供索引或目录变化时，用 `catalog_list({kind:"component",projectId})` 取得完整目录；选中后沿用返回的 scope/version/integrity 读取 guide 的内容组织、数据关系、交互与保存边界和示例；按需再取完整 schema/examples，准确区分同名组件。内容专用组件用于所属作品维护，专题组件遵守固定假设。修改实例数据不要求读取源码；模板复用页面结构，沿模板精确依赖读取组件说明。已有组件或组合足够时直接复用；存在明确的表达或交互缺口时进入 [create-component](../create-component/SKILL.md)。需要可复用模板时进入 [create-template](../create-template/SKILL.md)；应用已有模板则直接用 template_apply。

普通报告保留一份 Page，用章节、区域和嵌套容器组织。用户要求网站或多个独立文档时才拆分页面。后续修改继续使用原 pageId。新建复杂作品时先用 catalog_list 查询 template，并读取匹配模板的 guide；有匹配结构就通过 template_apply 建立本次 Page，再按分镜调整实际内容和布局。没有合适模板或用户指定从空白开始时才用 page_create。修改前 page_read完整源数据，保留 hash、revision与稳定节点 ID，再用 page_apply或page_save。

```json
{
  "projectId": "已核实项目ID",
  "pageId": "已读取页面ID",
  "baseHash": "读取结果的hash",
  "baseRevision": "读取结果的revision",
  "operations": [
    {
      "type": "block.text.set",
      "blockId": "稳定节点ID",
      "text": "修改后的正文"
    }
  ]
}
```

这是 page_apply 的参数形状，具体操作查询当前 guide/inputSchema。不要用局部读取或选区导出覆盖完整页面。CONFLICT时比较原始基线、当前内容与尝试稿后处理，不能只换 hash/revision覆盖。跨设备冲突可能返回新的 document.id，后续使用实际返回值。

## 结构与内容

新资源使用 v3：根和嵌套容器为 `surface`，kind为 page或board。Page按树顺序阅读，Board表达局部空间。`layout`保存父级给子对象的外框，`surfaceViews`保存命名视图与阅读顺序；当前选中、滚动与展开属于个人状态。原生容器保持surface结构，不编码成普通widget。绘画保存在Board中；连接、旋转和变换按需读 [Board 编辑](references/board-authoring.md)。

组件节点使用稳定 attrs.id。自定义组件用 kind=custom，data包含componentId、version、integrity与props。不得把组件包 ID当成内置kind。文字统一使用富文本组件（kind=text），优先提交 format=richtext 与 doc 内容树；文字格式放在 marks，段落对齐放在 attrs.textAlign。通过组件插入形成原生 richText 节点，沿页面读取返回的稳定子节点 ID 续改。旧 Markdown/plain 字符串兼容导入；公式支持行内与块级形式，代码块保持原文。视频、音频、PDF与参考文献优先复用内置组件，先查schema。离线交付所需资源必须嵌入；在线资源的网络要求要如实说明。教学示例明确标记，不能冒充实测数据。

## 排版与视觉风格

页面创作、续改与模板应用遵循以下默认规则；用户明确指定特殊设计要求时按其要求执行。需要创建组件来承载页面内容时，把这些规则带入组件设计。

- **标题直述主题。** Page 已显示作品标题时，正文直接进入核心回答或首幅主图，不再插入同名 H1。 不用 slogan（口号）充当标题，不使用全大写英文标题，也不在 slogan 上方叠加一行标题。
- **减少框形装饰。** 优先用留白、对齐、间距和分隔线组织内容；矩形与圆角矩形仅用于有明确意义的分组、图形表达或交互区域，避免给每段文字、每个要点套框。
- **固定字体体系。** 除非有特殊要求，中文和英文分别选择一种固定字体，同一作品保持一致；通过字号、字重与间距建立层次。
- **控制小字。** 排版前按阅读场景确定正文基准字号与最小字号。除极少量备注外，说明、标签及其他正文文字不小于正文基准字号；空间不足时调整布局或精简内容，不靠缩小文字塞入。
- **建立长文层次。** 大段文本按语义分段，配合小标题组织阅读顺序；用适量的加粗、下划线、底色或文字颜色标注重点，同类重点保持一致，避免整段强调或同时堆叠多种样式。

## 独立交付

用户明确要求不入库或只要独立文件时，可用公开目录与 `render_document({document或templateId,title?,componentSources?,blockIds?})`。document与templateId二选一；自定义源码对象沿用component_save.source结构。读取persistence回执：独立渲染不创建个人项目，也不进行同步。需要后续正式保存时，再把完整文档与组件保存到明确项目。

## 容量

创作大页面或带资源的内容前，读取 showai_capabilities 的 capacities，并按 [容量与大文件](references/capacity.md) 判断具体边界。页面结构、原始资源、组件包、完整导出与聊天预览分别计算；聊天预览超限时仍保留完整 Page 和文件。

## 验证与交付

按 [呈现评审标准](../review-presentation/references/review-criteria.md) 执行与本次内容有关的检查；用户要求整体评审时进入 [review-presentation](../review-presentation/SKILL.md)。事实、主线、可读性、交互与恢复分别检查。静态交付保留关键状态、条件和来源，不能仅用交互初始截图代表完整内容。没有真实读者试读时不宣称已证明理解效果。

源内容用page_read核对；布局用image，同时检查标题、框形装饰、字体一致性、最小字号与长文重点层次；交互按 [阅读视图](references/page-reading.md)检查，并遵循宿主实际UI操控规则。正式编辑不能由临时预览代替。工具回执、视觉检查和实际操作分别记录；未验证的部分不得称为通过。

正式保存后使用 `page_present({projectId,pageId,blockIds?})`。它返回完整HTML/source与可选inline预览；宿主/运行时决定输出路径。按 [对话展示](references/conversation-display.md)实际显示。支持聊天预览时交付本轮引用；完整文件链接为补充。用户要求只保存、只要文件、面板展示或后台执行时遵循指定形式。

局部展示从完整Page取得真实节点ID；选中容器包含子树。page_present的完整HTML与source保留全页，blockIds只限制inline；不能通过自定义组件内部DOM ID选择页面节点。超限时选择可独立理解的节点重新展示，保留完整源Page。明确请求文件或网站导出时用可用的page_export，核对它的格式、选区与路径约束。宿主不支持显示时交付页面身份、保存/同步结果和可用文件，不自行改写内容归属。

---
name: show-document
description: 通过 ShowAI MCP 制作、续改、展示和导出可交互报告、讲解页面与小型网站。完整作品请求（包括只给题目）使用；按当前阶段读取模板指南与组件说明。
---

# 创作与展示

先读取下面的系统基线；它适用于每个呈现任务。用户要求成品时持续完成制作、修订与交付。只要求对话讨论时直接回答；完整设计稿默认按用途保存，设计任务不自动实现拟议应用或组件。

<!-- showai-system-baseline:start -->
# 系统呈现规则

所有 ShowAI 呈现任务使用本系统模板。用户的明确要求优先；简单任务可合并阶段，已有有效材料可复用。

完整作品依次完成意图理解、材料处理、理解路径、视觉交互、页面制作、评审交付。每一步形成足以接续的记录，按问题回到负责它的阶段；制作请求持续完成可用成品。

从读者当前认知出发，关键概念、条件与证据有明确落点；复杂作品在制作前记录理解树和具体分镜。对象、空间、连接及状态承担解释工作，文字补足精确含义。首屏含核心回答、范围与可理解总览。

标题直述主题；正文不重复 Page 标题。优先以留白、对齐和语义分组组织内容；固定中英文字体体系，按阅读场景确定基准字号，空间不足时调整结构。长文按语义分段，重点样式保持一致。

模板 README 提供用途与会话索引；阶段指南在进入该阶段时按需读取。模板组件采用返回的固定版本与指纹，系统规则始终有效，具体模板不能关闭它。使用 template_context 指明本轮模板集合，避免共享的全局“当前模板”。

正式作品保存 Page，保存、展示与同步分别确认；冲突保留草稿并处理。只读操作不改写正文。遵循宿主实际电脑操控规则，明确检查范围；没有真人试读不声称已证明理解效果。

模板可选 page.json 骨架，并支持基础的组合定义；嵌套不是各阶段必做步骤。模板声明无自定义组件时 components/ 可为空。网页端通过 MCP 读取同一份指南和组件包，不要求访问本机路径。

系统基线内容哈希：`494a39380e4fa8456955d53bf677975ace0aadb21140b4f3a0b663f8ebd89b91`。本轮已读到同一内容时，可用 knownSystemHash 避免重复返回；没有读过时不要仅凭哈希声明已知。
<!-- showai-system-baseline:end -->

## 开始与阶段接续

首次连接/项目归属不明时读 [use-showai](../use-showai/SKILL.md)。核对 showai_capabilities.templateWorkflow.protocol 为 showai-template-workflow-v1；老运行时不支持新参数时说明实际缺项并更新/重连，不能声称仅安装 skill 就升级了工具。

复杂新作品先查模板目录的元信息，按读者任务与材料判断适配性；匹配则应用，用户要求空白或没有匹配时从空白组装。用户指定模板优先；未指定时可沿用会话绑定。明确要求空白时在 template_context 和 template_guide 传 templates:[]，覆盖会话默认值，保留系统基线。续改从源 Page 的 templateContext 恢复精确引用；没有记录时按现有页面、材料与系统基线判断，不能猜测它原先使用的模板。

调用 template_context({projectId,templates?,knownSystemHash?}) 取得系统、当前模板 README、固定引用和组件索引。保留 context.templates；组件较多时按 componentPage 分页。进入当前阶段再读 template_guide({projectId,stage,templates:context.templates})，只读相应指南，不默认读所有阶段。六阶段为 intent、evidence、understanding、design、authoring、review。knownHash 只用于本轮已持有的同一内容。

指南可补充领域方法；所需事实由本次材料与检索取得。只有题目时标明合理的读者/范围假设并推进；有影响的歧义才澄清，未结束月份以实际检索日为界。目录与基础说明不会代替真实研究。

## 制作与验证

编辑 Board 的绘画、对象属性、布局或连接时，按需读 [Board 对象编辑](references/board-authoring.md)，再以当前运行时 guide 和真实页面核对字段及操作能力。

需要具体操作时才读 guide authoring/containers/document 等技术说明；选择组件后读其精确 guide，再按当前材料用parameters的parameterPath查字段含义、约束、遗漏行为和例子；只在需要原始结构时读schema。模板组件采用 template_context 返回的 componentId/version/integrity，不能把局部名字当内置 kind。现有数据调整或组件组合够用时复用；明确缺口进入 [create-component](../create-component/SKILL.md)。新建可复用模板进入 [create-template](../create-template/SKILL.md)。

模板应用用 template_apply，可带本轮固定 templates。空白路径用 page_create。修改前 page_read({projectId,pageId,rendered:false,response:"source"}) 读取完整源、hash/revision；局部编辑同时保留必要基线，不用局部 source 覆盖整页。优先 page_apply 的稳定节点操作，response:"receipt" 只收保存回执。需要新模板绑定时以 page.set.fields.templateContext 保存 template_context 返回的 format/system/templates，去掉 hash；运行时仍强制提供自身系统基线。CONFLICT 必须比较基线、当前内容和尝试稿，保留无关修改。

复杂作品在制作前保存理解树与具体分镜；格式见 [理解规划](../plan-presentation/references/understanding-plan.md) 和 [表达与分镜](../design-presentation/references/expression-and-storyboard.md)。已有有效规划可复用。校验脚本直接执行即可，不为使用它加载整段源码。

源检查用 response:"source"；派生值/计算读模型按需请求 full/rendered。图像检查可用 response:"receipt"，图片仍返回，避免同时重复整页 DOM。实际宿主交互遵循官方操控规则；没有执行的路径明确标注。完成后读当前 review 阶段并按 [review-presentation](../review-presentation/SKILL.md) 检查真实分镜对应、画面与操作。

正式保存后用 page_present，按 [对话展示](references/conversation-display.md) 展示本轮真实 delivery。容量按需读 [容量](references/capacity.md)，局部展示/临时状态读 [页面阅读](references/page-reading.md)。只有用户明确独立交付时用 render_document；连接、保存或显示失败不自动改变内容归属。

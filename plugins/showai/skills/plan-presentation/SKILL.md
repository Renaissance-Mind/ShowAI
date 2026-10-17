---
name: plan-presentation
description: 完成呈现的前三个阶段：理解读者意图、收集与处理材料、构建多级呈现逻辑，形成读者简报、材料底稿和呈现规划。需要讲解规划或重组难理解内容时使用；成品继续 show-document。
---

# 规划呈现

系统基线可来自已读的 [show-document](../show-document/SKILL.md)、template_context.system.readme 或 guide({topic:"presentation"})；本轮已持有同版基线时直接复用。连接与归属不明才读 [use-showai](../use-showai/SKILL.md)。

用户只要对话提纲时，用已持有的系统基线直接规划，不必调用 template_context 或 template_guide。正式作品取得或复用 template_context 的固定模板引用，进入哪个阶段就读哪个阶段的 template_guide（intent、material、logic），不为局部规划把 design 也一次读入。三个阶段各形成一份记录，格式与交接条件见 [呈现工作约定](references/presentation-contract.md)。

## 理解意图

把用户的表面要求和推断出的深层需求分开写，说明依据；两者不一致时按深层需求组织、但显眼回答用户问到的内容。判断读者已经理解什么、缺少什么、可能误解什么；会影响后续理解的误解先澄清（给可核实的定义、例子或反例），再推进原任务。写出可检验的任务结果与环境约束。只有题目时标明合理假设并推进；只有不同理解会导致完全不同作品时才提问。

## 收集与处理材料

从读者简报倒推需要哪些事实、数字、例子、图像或原文，确定来源并逐条核对：原值、来源定位、条件、性质（事实/主张/推断/示意）、用途。通用场景没有专门采集方式时可以省略这一阶段，但要用到的事实仍做来源与条件检查。模板 material 指南给出该类内容的采集清单时按清单执行。冲突记录差异不取平均；缺口写进底稿，不编造。

## 呈现逻辑

从读者当下认知出发做多级规划：第一级选整体逻辑并写出各环节主题；第二级写每个主题要讲清的定义、关系、过程、例子、条件；对仍难理解的部分继续展开，直到叶子写出具体内容。每一层判断是否符合读者认知、能否理解、是否还要解释。每个节点有通过条件；先备关系用 needs 标出；各分支深度不同。格式见 [呈现逻辑](references/presentation-logic.md)。

## 交付

用户只要对话提纲时直接交付；正式完整规划保存并展示。复杂作品在进入设计前把规划保存为 `presentation-plan.json` 并运行 `scripts/check_plan.py`。用户要设计稿时继续 [design-presentation](../design-presentation/SKILL.md)，要成品时继续 show-document；已有有效记录不重新开始整条流程。

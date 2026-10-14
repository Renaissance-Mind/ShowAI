---
name: review-presentation
description: 评审页面、报告或设计是否支持读者任务，定位证据、理解路径、视觉和交互问题，按授权修订。读取当前 review 阶段与真实作品，截图、操作和读者试读分别报告。
---

# 评审呈现

取得目标、认知起点、环境和完整作品。只读请求保持只读；用户要求修改时完成连贯修订。系统基线可来自已读的 [show-document](../show-document/SKILL.md)、template_context.system.readme 或 guide presentation；本轮已持有同版基线时直接复用，不再重复读取。已知连接与身份时直接读当前 Page/hash/revision，不重复发现。

从 Page.templateContext 或本轮记录恢复精确模板引用，读取 review 阶段。没有前置规划时说明无法证明历史设计对应，不事后补写并冒充原规划。按 [评审标准](references/review-criteria.md) 检查真实内容与操作，设计稿检查设计，成品才执行对应界面路径。

逐项记录位置、阅读/触发路径、实际障碍、证据和修订方向。优先处理错误结论、关键条件缺失与主要任务失败。理解主线问题回到规划，表达/状态问题回到设计；保持稳定身份和无关修改，冲突保留草稿，不仅换 hash 覆盖。

最终 scenes 对应真实 blockIds。按 [评审标准](references/review-criteria.md) 的复杂作品回查，用 `check_plan.py <最终规划> --page <页面源 JSON>` 检查结构和引用；不带 --page 时不会核对 blockIds。之后人工核对对象、关系、步骤、条件与阅读顺序；结构通过不证明语义正确。修订后复查原问题及相邻影响。没有新变化或未决问题时不扩大重复测试。

交付具体问题或已完成修订、保存/展示回执与验证范围。没有真人试读不声称已证明理解效果；实际截图、操作和模型复核分别说明。

---
name: design-presentation
description: 把理解规划转成具体视觉与交互设计，决定对象、关系、布局和状态，选择模板及组件。设计稿请求使用；按当前 design 阶段披露指南，成品继续制作。
---

# 设计表达

沿 [show-document](../show-document/SKILL.md) 的系统基线；独立设计入口先读 guide({topic:"presentation"})，本轮已有相同基线可复用。缺少会改变结构的规划时补 [plan-presentation](../plan-presentation/SKILL.md) 的相关部分，不重做整篇。

取得或复用 template_context 与固定引用，读当前 design 阶段。用户要求空白时两处都传 templates:[]，覆盖会话默认模板，沿系统基线设计。先形成符合内容关系的表达候选，再按 [复用选择](references/reuse-selection.md) 查询模板元信息和实际组件能力。组件/模板本轮精确版本已读的 guide 可复用；修改实现才读源码。阶段文件夹先读其 README，必要时用 template_guide 的 templateId/file 取该阶段子文件，不把所有文件默认展开。

按 [分镜格式](references/expression-and-storyboard.md) 记录具体对象、位置、关系、标签、阅读顺序、文字落点及状态。每幕服务清楚的理解任务，重要条件直接可见；交互要有可观察的变化和恢复，静态保留主线，窄屏按真实内容重排。用 Image Gen 生成准确构图/概念示意时，检查事实、连线、数量和标签，保留可编辑的精确数据与交互对象。

交付完整设计稿与必要素材；用户只要设计时按用途保存和展示，拟议状态不记为已实现。完整制作请求继续 show-document。发现能力缺口时记录输入、输出、状态、验收条件，获得制作授权且确需实现时，再进入 [create-component](../create-component/SKILL.md)。

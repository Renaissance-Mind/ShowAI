---
name: design-presentation
description: 完成呈现的第四阶段：把呈现规划转成逐幕设计稿，确定环境、整体布局、每个部分的视觉表达、文字落点与交互，选择组件与素材。设计稿请求使用；成品继续 show-document。
---

# 设计表达

系统基线可来自已读的 [show-document](../show-document/SKILL.md)、template_context.system.readme 或 guide({topic:"presentation"})；本轮已持有同版基线时直接复用。缺少会改变结构的读者简报或呈现规划时补 [plan-presentation](../plan-presentation/SKILL.md) 的相关部分，不重做整篇。

取得或复用 template_context 与固定引用，读当前 design 阶段的 template_guide。用户要求空白时两处都传 templates:[]，沿系统基线设计。阶段文件夹先读其 README，必要时用 template_guide 的 templateId/file 取子文件。

## 设计顺序

1. **环境**：分辨率、长宽比、是否可交互、是否需要静态导出；默认 1440×900 可交互。
2. **整体布局**：首屏内容、各部分顺序、分区与导航、图文相邻的节奏、全页固定的对象名称与颜色。
3. **每个部分**：先按读者任务选表达形式，再写 composition（对象、相对位置、箭头或尺度、准确标签、颜色、阅读顺序、文字落点），详细到接近图像生成的提示；再写文字角色（标题、导语、图注、要点，哪些词加粗或着色）、交互（trigger / change / reset）、静态与窄屏方式、素材来源。
4. **组件与素材**：按 [复用选择](references/reuse-selection.md) 查询模板组件索引和当前目录，读取精确版本的 guide 与 parameters；真实图片记录来源，生成图先写下必须保持准确的对象、数量与标签。

每幕服务清楚的理解任务，重要条件直接可见；交互有可观察的变化和恢复；静态保留主线；窄屏按真实内容重排。视觉优先、文字补足、加粗与颜色含义一致。格式与示例见 [设计稿](references/design-draft.md)。

## 交付

交付完整设计稿与必要素材；复杂作品把 scenes 追加到 `presentation-plan.json` 并运行 `../plan-presentation/scripts/check_plan.py`。用户只要设计（“先别做页面”）时，不实现成品页，但设计稿本身是可审阅成果：对话中交付可读的逐幕设计稿；正式交付时按用途保存为一页可读的设计稿 Page（每幕一节：画面、文字、交互、静态与窄屏、素材、通过条件），scenes JSON 作为工作材料另存；拟议状态不记为已实现。完整制作请求继续 show-document。发现能力缺口时记录输入、输出、状态、验收条件；获得制作授权且确需实现时进入 [create-component](../create-component/SKILL.md)。

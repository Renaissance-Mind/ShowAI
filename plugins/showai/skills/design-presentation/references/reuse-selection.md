# 模板与组件选择

模板复用某类内容的呈现方法（四个阶段的指南）和可选组件库；组件复用图形与交互能力。Page 保存本次事实、素材、布局和精确依赖。先选择适合内容关系的表达，再核对当前可用资源。

## 模板

新建复杂作品时查询 `catalog_list({kind:"template",projectId})`，按 README 的 scenarios 判断是否匹配读者任务与材料；对匹配项用 template_context 读取 README 与固定引用，进入阶段时再读 template_guide。运行时内置系统基线 `system-presentation` 与论文讲解 `paper-explainer`；项目与全局目录中可能有更多模板，以工具实际返回为准。老运行时没有某模板时按相同方法从空白组织，不能声称已应用不存在的模板。

用户明确指定从空白开始时沿用其选择；其余请求匹配则在制作阶段用 template_apply 创建空白 Page（绑定精确引用）并按设计稿填入内容。目录查询与组件选择是不同操作，componentCatalog 不包含模板。

模板指南是方法，不是实际调研结果。缺少必需证据时保留缺项或缩小结论，不为满足模板制造内容；成品不残留填写提示。

## 组件候选

先确定表达形式，再查完整的当前组件索引：模板组件来自 template_context 返回的固定引用（局部名由模板 design 指南给出，实际 componentId/version/integrity 以返回为准）；内置与项目组件来自 `catalog_list({kind:"component",projectId})`。常用对应：

- 对象与材料：image、gallery、video、pdf；局部热点是否可用查具体组件。
- 概念与关系：flowchart（journeys 逐步走一条路线，stages 按阶段改变节点状态）、mindmap、layer-diagram 分层架构、sequence-diagram 参与者之间按顺序的往返；项目目录有专题图形组件时按其 guide 使用。
- 操作与参考：step-guide 编号步骤、分平台代码、读者逐步勾选与计时；command-reference 可搜索的命令与参数；structure-browser 目录或字段结构与说明；card-grid 入口与选项卡片。
- 时间与计划：roadmap 按日期阅读泳道、负责人、依赖和里程碑（只读）；event-timeline 事件、阶段与指标曲线同轴回放；database 的 calendar 视图展示带日期的记录、打卡热力与连续天数；roadmap 只负责阅读，需要持续编辑的排期用 database 等可编辑数据。
- 机制与状态变化：mechanism-steps 保持对象身份并逐步显示状态与作用关系。
- 对照与证据：evidence-explorer 连接总览、条件、来源和共同维度比较；waterfall 从期初到期末的逐项增减；table、database、comparison-matrix、chart 与适配数据类型的 G2 图表；references 和 bookmark。
- 补充说明：text、toggle；关键条件进入主线。
- 参数探索：playground 用声明式公式、预设、目标差距、分项构成和加权排名，只做它公开的有限运算；专题模型按各自假设使用。
- 空间与三维：scene-3d 用基本形体、坐标箭头、标注和参数绑定解释姿态、结构与转动；平面图能讲清时优先平面图。

顺序：调整实例数据和布局 → 组合已有能力 → 扩展已有组件 → 为确认的缺口创建新组件。通用、专题、内容专用分别判断，不能仅因外观相似复用写死事实的作品组件。

选用后读取精确版本的 guide；参数类型、单位、坐标系和关系按 parameters 参考核对，按 parameterPath 取当前对象涉及的字段，不把整个目录的参数表一次读入。缺失说明保持未知，不仅凭字段名猜单位或默认行为。

组合不足时，为 create-component 提供：输入与输出、视觉语义、读者操作、状态归属、空态与错误态、窄屏与静态方式及通过条件。新能力完成后回到整体作品制作。

# 组件参数契约

使用当前 guide component 的 documentationSchema，确认能力 componentParameters.protocol 为 showai-component-parameters-v1。新创作使用 documentation.version=2；旧 v1 可兼容读取，参数参考明确缺项，不自动宣称完整或改写旧版本。

类型、必填、枚举、范围、长度及结构来自 props.schema.json。读者交给对话的探索状态（`onContext`）不是参数：不写入 schema、defaultData 或例子，只在 usage.interactions 说明。usage.inputs 记录 path、meaning，以及需要时的 units、coordinateSystem；路径可以用 dotted[] 或转义的 JSON pointer，数组元素用 *。没有参数的固定组件可用空inputs与封闭的空对象schema；不能把任意自由输入伪装成无参数。父参数的单位和坐标系可由子字段继承，单字段查询也保留该上下文。公开字段的含义要有明确说明，schema.description 可提供含义；数组的纯值元素可沿用数组含义。自由 JSON/对象必须说明 opaque:true 的外部格式与边界，不能把故意留空的 schema 当作严格校验。

可选/条件字段明确 omission：behavior 为 omit、reject 或 fallback，description 解释实际行为。必填字段由 schema 表达拒绝缺项；可选字段不能声称拒绝缺项却不定义 required。fallback 选择一个 value（真实JSON值），或 from:{path,selection:"first"|"last"} 表达从实际材料选值；派生回退可用 computedFrom:[字段路径] 声明真实输入，并在 description 解释计算规则，例如区域中心由 x/y/w/h 计算；框架不执行文字公式，需实际验证结果。三种来源只选一种。它描述组件行为，不会自动填充或保存数据。defaultData/例子是初始化与使用实例，schema.default 是注释；组件自身的回退必须通过实际运行检查。

usage.rules 支持以下声明，使用字段路径引用本组件数据：

- unique：{kind:"unique",path:"slides[].id"}，ID/值在所在数组内唯一；不同父数组可使用相同局部ID。
- reference：{kind:"reference",path:"initialSlide",target:"slides[].id"}，引用指向同一共享父作用域的真实目标。
- index：{kind:"index",path:"slides[].blocks[].target.region",target:"slides[].visuals[].regions",via:{source:"slides[].blocks[].target.visualId",target:"slides[].visuals[].id"}}，零起始整数索引先按ID选定目标数组，再检查范围。目标无需ID选择时省略via。
- sumMaximum：{kind:"sumMaximum",paths:["slides[].visuals[].regions[].box.x","slides[].visuals[].regions[].box.w"],maximum:100}，相同数组作用域内的坐标与宽度之和不越界；y+h另声明。每个单独字段仍在schema中定义数值范围和必填。

所有规则引用实际 schema 参数。坐标说明必须给出单位、原点、轴方向和缩放规则；100百分比、0–1归一化值与像素不能混用。索引必须说明零/一起始，标识符说明作用域；原文页码等真实编号不能与数组索引混淆。

保存时，v2检查路径、覆盖、可选字段遗漏行为、回退值/来源样例、派生来源路径、schema、defaultData和所有例子。关系规则检查实际页面写入、组件编辑和生成的离线校验器。框架只校验已声明规则，不能自动推断所有业务关系。根据内容补齐规则，并在真实Page检查初始/空态、选择、错误、恢复、键盘、窄屏、只读与编辑边界。

选用时，catalog_describe({kind:"component",id,scope,version,integrity,view:"parameters",parameterPath?})返回字段含义、约束、遗漏行为、样例和相关规则。默认20项、上限50，按nextPage继续；knownHash用于已持有的相同页。大样例会给出显式省略信息，必要时读取对应真实例子；实现源码用于开发，guide 返回的 authoringReference 所指制作资源用于正常组件使用。guide给任务用法，development给修改边界，两者不代替参数参考。

无选择状态可在 reference/index 规则显式声明 sentinelValues，例如 index 的 [-1] 或 reference 的 [null]；字段schema也必须允许这些值，说明它们的实际意义。普通索引仍为零起始。未声明的负值、无效ID与歧义目标继续拒绝。

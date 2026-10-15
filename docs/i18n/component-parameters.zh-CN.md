# 版本化组件参数参考

**语言：** [English](../component-parameters.md) | 简体中文 · [文档目录](index.zh-CN.md)

参数的权威来源是 props.schema.json 的机器结构、manifest.documentation.usage.inputs 的含义与省略行为，以及实际 defaultData/examples。`catalog_describe(view:"parameters")` 从这些内容生成可读参考，无需手写第二份参数表。

## documentation v2

保留复用、recipes、交互、限制、编辑与开发章节，并设置 documentation.version 为 2。每个公开参数在 usage.inputs 或 schema.description 中说明含义。路径支持点号、[]、JSON Pointer 的 * 数组通配符以及 ~0/~1 转义。原始值数组项可继承数组解释，子字段可继承父级单位/坐标背景。

零参数组件使用空 inputs 与封闭空对象 schema。可选/条件字段要声明省略行为；不透明外部载荷要说明可接受格式与校验边界。

```json
{
  "path": "initialSlide",
  "meaning": "初始阅读页的 ID。",
  "omission": {
    "behavior": "fallback",
    "description": "省略时选择第一张实际页面。",
    "from": { "path": "slides[].id", "selection": "first" }
  }
}
```

省略行为为 reject、omit 或 fallback。fallback 只能声明一种来源：JSON 值、其他参数的 first/last，或 computedFrom 路径与推导说明。协议检查路径，不执行说明中的公式；实际计算需验证渲染器。必填字段不能承诺省略。schema.default 与初始化数据分别显示，不自动填充输入。string format 仅为注解，目前不启用格式校验。

usage.rules 支持数组值/ID 唯一、作用域引用、零起始索引与数值 sumMaximum。路径必须对应实际 schema 参数。百分比坐标应同时声明单字段范围与 x+w/y+h 总量关系；units/coordinateSystem 说明原点、方向和尺度。

同一关系校验函数用于默认/示例数据、真实页面保存与离线/嵌套组件校验，不执行任意代码或服务调用。未知规则拒绝，可选缺项保持缺失。旧 v1 包保持可读且不修改，生成参考会披露缺失说明与约束；存在 v1 标记不代表 v2 完整。

## 按需查询

先检查 `showai_capabilities.componentParameters.protocol` 为 `showai-component-parameters-v1`，再读目录元数据和精确组件 guide。v2 guide 指向参数参考，避免重复返回完整 schema。

```json
{
  "projectId": "PROJECT",
  "kind": "component",
  "id": "COMPONENT",
  "scope": "project",
  "version": "1.0.0",
  "integrity": "sha256-…",
  "view": "parameters",
  "parameterPath": "slides[].regions[].box",
  "parameterLimit": 20
}
```

每页包括约束、含义、省略行为、真实样本与相关规则，并保留精确身份。parameterOffset/parameterLimit 默认 20、最大 50，按 nextPage 继续。knownHash 仅用于本会话持有的相同文本，仍检查授权与身份。响应超过 64 KiB 需缩小子树/页数，不静默截断；超大示例值明确标注省略及其实际来源路径。

本机 MCP、授权 HTTP MCP 与公共组件查询使用同一接口。CLI 对应 `catalog describe ID --view parameters --parameter-path PATH --parameter-offset N --parameter-limit N --known-hash HASH`。这些选择器只适用于组件 parameters view，其余 view 继续独立查询。

## 校验范围

v2 校验建立 schema/说明一致性和已声明的关系检查，不证明每个渲染器都实现了所述默认行为，也不证明业务约束或读者理解。另行检查数据变化、无效编辑、初始/空状态、重置、键盘、窄屏与导出。

无选择状态可在 reference/index 规则声明 sentinelValues，如 index 的 [-1]、reference 的 [null]；字段 schema 也要允许并解释这些值。普通索引仍从零起算；未声明负值、无效 ID 与歧义目标拒绝。

# G2 数据组件

组件库的「数据」类目提供 **43 个 G2 图表**，均为内置组件，所有项目可插入使用。原有数据图表保持兼容。

插入组件后，通过设置修改标题、高度、字号、线宽、调色板、图例、动画与交互开关。数据和字段对应保存在页面源文件中。阅读态的主题切换仅改变当前视图。

## 数据接口

`datasets` 保存一个或多个数据源。多数图表使用 `main`；组合图使用 `layer-0`、`layer-1`；地图使用示例中命名的数据源。按组件的 schema 与 examples 查看具体结构。

`fields` 将图表示例的字段名对应到自己的数据字段，**不改变保存的原始记录**。例如柱状图：

```json
{
  "title": "数量比较",
  "datasets": {
    "main": [
      { "label": "甲", "amount": 4 },
      { "label": "乙", "amount": 9 }
    ]
  },
  "fields": { "genre": "label", "sold": "amount" },
  "theme": "indigo",
  "height": 320,
  "appearance": { "palette": ["#120A8F", "#EA8A3B"], "fontSize": 14 },
  "interaction": { "tooltip": true, "elementSelect": true }
}
```

组件名称以 `g2-` 开头，例如 `g2-bar`、`g2-line`、`g2-violin`。Agent 使用普通目录查询、页面插入、保存与导出命令。

自定义父组件可以通过 **ShowAI SDK** 组合它们：

```tsx
import { G2Bar, G2Line } from "showai:components";
```

原始 G2 npm 导入仍限制在软件运行时；自定义组件继续使用 **ShowAI SDK**。编译器只开放受控的运行时依赖，不允许任意 npm 包。

## 渲染与分发

G2 5.4.8 使用本地 SVG 渲染器。旭日图使用官方 plot 扩展；Kagi 用基础图形组合实现。内置示例使用上游数据节选；地图边界简化，分级地图默认示例是州内县失业率的未加权均值。**正式内容应替换为自己的数据并保留口径说明**。

G2 内置组件、组件派生、阅读器与离线 HTML 使用**同一实现**。包包含第三方许可证声明；组件导出 HTML 同样保留声明。JSON 数据错误、缺少字段和渲染失败均显示原因。

默认数据及元数据由 `scripts/generate-g2-components.mjs` 从已审查示例提取。绘图逻辑位于 `src/components/blocks/g2/`；编辑界面位于 `G2Chart.tsx`。

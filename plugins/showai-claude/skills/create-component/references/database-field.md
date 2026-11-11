# 数据库字段类型

数据库内置的字段类型（文字、数字、单选、多选、复选框、链接、日期、页面、关联、公式、汇总）不够表达一种值时，例如评分、进度、货币或颜色，可以做一个字段类型组件。保存后，这个类型出现在数据库「添加属性」和属性设置的类型菜单里，不需要更新 ShowAI。先用 `catalog_describe({projectId, kind:"component", id:"database", view:"guide"})` 的 `fieldTypes` 确认内置类型和项目里已有的字段类型确实不够用。

## 一个组件提供两部分

字段类型由一个组件包声明，分两半：

- **值的部分**（ShowAI 负责筛选、排序和读取）：manifest 写 `role:"database-field"` 与 `databaseField:{protocol:1, valueKind, operators?}`。`valueKind` 说明值按哪种方式比较：`text`、`number`、`date`、`option`、`list` 或 `boolean`；`operators` 可选，从这种值的运算符中选出要提供的几个（完整列表见 fieldTypes 的 `operators`），省略时提供全部。入口文件命名导出 `field`：
  - `format(value, config)`：同步返回单元格显示的文字，或 `{text, tone}`，`tone` 取 gray、brown、orange、yellow、green、blue、purple、pink、red 之一，显示为带颜色的标签。表格、看板、列表、搜索和 CSV 导出都用它。
  - `project(value, config)`（可选）：同步返回按 `valueKind` 比较的值，例如数字、`YYYY-MM-DD` 日期或文字列表；筛选和排序用它。省略时直接按存储的值比较。
- **单元格的部分**（数据库负责摆放）：入口的默认导出是编辑器，读者点击单元格时显示在单元格下方的小面板里。它收到 `data`（这一列的设置）、`value`（当前值）、`onValue(next)`（保存新值）和 `onClose()`（关闭面板）；只读时没有 `onValue`。

`props.schema.json` 描述这一列的设置（例如评分的最高星数），`defaultData` 是新建这一列时的设置；数据库把它存在列的 `config` 里。存进记录的值只能是文字、数字、布尔值或文字列表。

两个函数和编辑器都在与普通组件相同的浏览器沙箱里运行，不能访问文件或网络；`format`、`project` 必须同步，异常会让该单元格回到显示原值。

## 示例：评分

```json
{
  "id": "star-rating",
  "name": "评分",
  "version": "1.0.0",
  "description": "数据库里的 1–N 星评分。",
  "entry": "index.tsx",
  "role": "database-field",
  "databaseField": { "protocol": 1, "valueKind": "number", "operators": ["is", "gte", "lte", "isEmpty", "isNotEmpty"] },
  "scenarios": ["给数据库记录打分"],
  "defaultData": { "max": 5 },
  "examples": [{ "name": "五星", "data": { "max": 5 } }]
}
```

```jsx
export const field = {
  format(value, config) {
    const n = Math.max(0, Math.min(config.max, Number(value) || 0));
    return n ? "★".repeat(n) + "☆".repeat(config.max - n) : "";
  },
  project(value) {
    return typeof value === "number" ? value : null;
  },
};
export default function RatingEditor({ data, value, onValue, onClose }) {
  return (
    <div role="radiogroup" aria-label="评分">
      {Array.from({ length: data.max }, (_, index) => (
        <button key={index} type="button" role="radio" aria-checked={value === index + 1}
          onClick={() => { onValue?.(index + 1); onClose?.(); }}>
          {index < (value ?? 0) ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}
```

`props.schema.json` 为 `{"type":"object","properties":{"max":{"type":"integer","minimum":1,"maximum":10}},"required":["max"],"additionalProperties":false}`。用 `component_save` 保存（同样需要 `documentation`，见 [组件设计](component-authoring.md)）。

## 在数据库中使用

保存回执给出精确的 version 与 integrity。数据库的列写成：

```json
{ "id": "rating", "name": "评分", "type": "custom", "component": { "componentId": "star-rating", "version": "1.0.0", "integrity": "sha256-…" }, "kind": "number", "config": { "max": 5 } }
```

`kind` 抄写组件声明的 valueKind（fieldTypes 的 contributed 条目里已经写好整列的 column）。记录里这一列写数字。在工作台中也可以从类型菜单直接选这个类型。视图的筛选条件用 `databaseField.operators` 中的运算符，例如 `{"column":"rating","operator":"gte","value":4}`。

组件被删除、版本找不到或在导出的离线页面中，单元格只读显示存储的原值，数据不会丢失；这些地方以及 `dataset_read` 的 query 按列的 `kind` 筛选与排序存储的值，所以 `format`/`project` 不改变比较方式时结果与工作台一致。字段类型组件不会出现在插入组件的菜单里。

## 验证

在测试页面放一个数据库：从类型菜单添加这一列，确认显示、编辑、按它筛选和排序；改 `config` 后确认显示随之变化；再用 `page_read` 读回，确认记录里保存的是原始值。改了 `field` 或编辑器后提高 version 保存，再用 page_apply 修改数据库的 columns，把这一列 `component` 的 version 与 integrity 换成新版本。

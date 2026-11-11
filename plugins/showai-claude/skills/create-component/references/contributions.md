# 组件填入的工作台位置（contributes）

工作台提供几个可以由组件填入的位置：快速跳转（⌘K / Ctrl+K）的命令、正文 @ 菜单里放进一行文字的组件、数据库的字段类型。组件在 manifest 的 `contributes` 中声明自己填入哪些位置，宿主读取声明后提供界面、排序、保存和导出，组件不实现这些机制，也不需要改动 App。内置组件用同一个 `contributes` 声明，例如内置日期组件的 `"contributes": {"mention": {"prop": "date", "input": "date"}}`。

```json
"contributes": {
  "commands": [ … ],
  "mention": { … },
  "databaseField": { … }
}
```

三项都可省略，可以同时声明 commands 与 mention，或 commands 与 databaseField；mention 与 databaseField 不能同时声明，因为字段类型组件的 props 是列的设置。声明属于不可变版本，修改后保存新版本。准确字段以 `guide({topic:"component"})` 返回的 `input.contributesSchema` 为准。保存时检查整个声明，错误统一写成 `contributes.<路径> <问题>`，例如 `contributes.commands[0].run.insert.example names a missing example`，按路径改正后重新保存。把 `commands`、`mention` 或 `databaseField` 写在 manifest 顶层会被拒绝。

`catalog_describe` 的 summary 带出组件的 `contributes`；`catalog_list({projectId, kind:"contribution"})` 列出每个位置以及项目中填入它的组件和导入器，用来查看已有的命令、@ 菜单来源与字段类型，避免重复制作。

## commands：快速跳转命令

快速跳转的输入框、排序以及页面、项目、工作台命令都属于宿主。每个以块插入的组件已经在这里提供“插入到当前页面”；`commands` 再加最多 20 条，每条为 `{id, title, keywords?, run}`：`id` 用小写字母、数字和 `-`，在组件包内唯一；`title` 是读者看到的命令名，写成动作，例如“插入今日站会”；`keywords` 是可选的搜索词。`run` 二选一：

- `{"insert": {"example": 0}}` 用第 0 个示例的数据插入组件，`{"insert": {"props": {…}}}` 用给定数据插入，两者都省略时用 defaultData。props 在保存时按 schema 与关系规则检查。插入命令只在打开可编辑的页面或白板时列出，组件插在选中块之后或光标所在的正文位置，没有选中时放在末尾。声明了 mention 或 databaseField 的组件不以块插入，它们的插入命令不会列出。
- `{"goTo": "showai://project/项目ID/page/页面ID?blocks=块ID"}` 打开页面并定位到块，效果与组件里调用 `goTo` 相同；命令不在任何页面中，所以要写完整的页面链接。

```json
"contributes": {
  "commands": [
    { "id": "today", "title": "插入今日站会", "keywords": ["standup", "daily"], "run": { "insert": { "example": 0 } } },
    { "id": "team-board", "title": "打开团队看板", "run": { "goTo": "showai://project/P/page/Q" } }
  ]
}
```

`catalog_list` 的 query 也匹配命令标题和关键词。保存后在工作台按 ⌘K 输入命令名，确认它出现并按预期插入或跳转。

## mention：放进一行文字的组件

用户在正文输入 @ 时，菜单列出页面，以及每个声明了 `contributes.mention` 的组件：

- `prop`：菜单填写的顶层 string 参数，schema 中必须存在。
- `input`：`"date"` 列出今天、明天、昨天和输入的日期（YYYY-MM-DD）；`"text"` 用输入的文字；`"options"` 只列出固定选项。
- `options`：可选的固定选项 `[{label, value, keywords?}]`，最多 50 个，value 写进 prop；`input:"options"` 时必填。

```json
{ "id": "person", "name": "同事", "version": "1.0.0", "entry": "index.tsx", "defaultData": { "name": "" },
  "contributes": { "mention": { "prop": "name", "input": "options", "options": [{ "label": "王芳", "value": "王芳", "keywords": "wangfang" }] } } }
```

本项目可用的组件（项目、全局、已发布和内置组件）都会进入菜单。选项随组件版本保存，名单变化时保存新版本；名单需要经常变化时用 `input:"text"` 让用户直接输入。选中后组件以其余参数的 defaultData 加上这个值放进当前行，存为行内节点 `{type:"inlineWidget",attrs:{kind:"custom",data:{componentId,version,integrity,props}}}`；Markdown 中自定义组件写 `@[custom]{"componentId":"person","version":"1.0.0","integrity":"sha256-…","props":{"name":"王芳"}}`，内置组件写 `@[kind]{data}`。组件此时收到 `inline: true`，应渲染成一行文字中的内容：不用块级外边距和固定宽高，宽度随内容。宿主按组件报告的尺寸设置行内框架；修改仍通过 `onChange`。这类组件不出现在插入组件的菜单里。验证时在正文输入 @ 选中组件，检查它与前后文字同行、可编辑和只读时的样子以及导出页。

## databaseField：数据库字段类型

`"databaseField": {"protocol": 1, "valueKind": "number", "operators": ["is", "gte"]}` 声明值的部分：`valueKind` 说明值按哪种方式比较，`operators` 可选，从这种值的运算符中选出要提供的几个。组件的入口还要命名导出 `field`（format、project），默认导出是单元格编辑器。字段类型的完整做法、示例和在数据库中的写法见 [数据库字段类型](database-field.md)。这类组件不出现在插入组件的菜单里。

## 与 contributes 无关的声明

- `pageReferences: true`（manifest 顶层）：组件用 `usePageReferences` 读取页面之间的引用，导出时带上这一页的引用。它说明组件自己的渲染要用到哪些数据，不填入工作台的任何位置，见 [组件设计](component-authoring.md#读取页面之间的引用)。
- 参数契约中的 `{kind:"page", path}` 规则：说明某个参数存的是页面链接，保存时检查链接格式并进入引用索引，见 [参数契约](parameter-contract.md)。
- `role:"page-outline"` 与 `pageOutlineProtocol:1`：页面目录渲染器，见 [组件设计](component-authoring.md#page-原生目录组件)。

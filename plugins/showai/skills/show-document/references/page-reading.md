# Page 三种读取视图

Page 的源数据与组件引用保持一份，读取视图按任务选择。沿用已经核实的 ShowAI CLI、项目与内容库，先查询 `guide reading --json` 获取运行时支持的参数。

## 选择读取方式

内容分析、任务数据和正文修改默认使用 `pages read` 的 structured 视图。JSON 保留源数据，`--format markdown` 返回正文、表格和组件数据的可读表达。长页面先 `--detail outline`，再用稳定节点 ID 选择 `--blocks`。局部结果标记 `partial`；编辑整页前重新读取完整页面。

颜色、行高、溢出、遮挡、选中与悬停状态使用 image。请求明确的宽高与主题，并保留返回的页面 hash、组件版本和状态。读取的是实际渲染的 PNG；MCP 会同时返回图像内容，CLI 返回图片文件及元数据路径。用宿主的图片读取工具查看像素。

点击、展开、筛选、表单和拖动使用 html。返回可打开的 HTML 文件及浏览器可访问性快照，组件内部快照携带其页面节点 ID。按快照中的可访问名称选择控件，或在明确的组件内使用 selector；运行 `actions` 验证行为。只有排查实现时才读取完整 HTML 源码。

```sh
showai pages read PAGE --project PROJECT --json
showai pages read PAGE --project PROJECT --detail outline --json
showai pages read PAGE --project PROJECT --blocks GANTT_NODE_ID --format markdown
showai pages read PAGE --project PROJECT --view image --theme light --width 1000 --height 900 --base-hash HASH --out ./gantt.png --json
showai pages read PAGE --project PROJECT --view html --state reading-state.json --out ./gantt.html --json
```

`--base-hash` 固定此次检查的源页面版本；页面已变化时返回冲突。`--out` 已存在时明确传 `--overwrite`。图片和 HTML 的 `.read.json` 保留来源、渲染状态和交互快照。正式写入继续走 `pages apply/save` 与当前 hash。

## 交互与临时编辑

`--state` 文件包含此次读取的状态。默认阅读交互只探索视图；需要验证任务修改或拖动保存行为时用 `draft: true`，变化留在临时预览里。返回的 `computed.props` 可以核对临时数据，正式 Page 不会自动改写。

```json
{
  "theme": "light",
  "viewport": { "width": 1000, "height": 900 },
  "draft": false,
  "actions": [
    {
      "type": "click",
      "blockId": "gantt",
      "role": "button",
      "name": "收起产品研发"
    }
  ]
}
```

控件名称以刚读取的快照为准。支持 hover、click、fill、select、check、uncheck 和 drag；fill/select 需要 value，drag 使用 dx/dy 像素。目标重复或不存在会报错。多次检查用累计动作序列重放，保持相同宽高；直接打开文件后也可用宿主浏览器继续操作。文件打开时从原始预览数据开始，已执行的动作记录在元数据里。

## 组件计算值与运行条件

声明 `reader: "readData"` 的组件会在浏览器沙箱里提供派生数据，例如甘特图父任务的汇总日期和进度。保留原始 props，按任务 ID 对应 `computed.data`，遵循派生字段标记。其他组件保留原始数据，按需通过 HTML 查看实际输出。

渲染读取使用已安装的 Chrome、Edge 或 Chromium，也可设置 `SHOWAI_BROWSER_EXECUTABLE`。命令不会自动下载浏览器。`--rendered false` 显式读取原始结构化数据，outline 也无需浏览器。渲染或组件读取失败时说明实际错误，不能以 JSON 可读作为视觉或交互通过的证据。

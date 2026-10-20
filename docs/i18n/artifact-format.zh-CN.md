# ShowAI 页面数据格式 v3

**语言：** [English](../artifact-format.md) | 简体中文 · [文档目录](index.zh-CN.md)

v3 用可递归嵌套的原生 Page 与 Board 保存内容。Page 按阅读顺序排列，Board 使用局部空间布局；两者都可作为根或嵌入模块。新资源默认 Page，v1 文档与 v2 白板继续可读。

## 外层结构与容器

```json
{
  "format": "showai",
  "version": 3,
  "document": {
    "id": "research",
    "title": "研究报告",
    "content": {
      "type": "surface",
      "attrs": { "id": "root", "kind": "page", "name": "报告" },
      "content": [
        {
          "type": "surface",
          "attrs": { "id": "board", "kind": "board", "name": "分析" },
          "content": []
        }
      ]
    },
    "layout": {
      "board": {
        "x": 0,
        "y": 0,
        "width": 800,
        "height": 460,
        "heightMode": "fixed"
      }
    },
    "surfaceViews": {
      "root": { "initial": null, "saved": [], "readingOrder": ["board"] },
      "board": { "initial": null, "saved": [], "readingOrder": [] }
    }
  }
}
```

所有非文本节点都有唯一稳定 `attrs.id`。资源 ID 标识页面文件，根容器 ID 标识内容节点。`surface` 的 kind 为 page/board；`region` 保留 flow/grid/free 分组；`richText` 承载普通编辑器区块。

`layout[nodeId]` 保存父级赋予的 x/y/width、可选 height 与 heightMode。Page 支持 auto 高度，Board 保持有界窗口。Board/free 子对象使用局部坐标；Page/flow/grid 遵循树顺序。几何限制、旋转与箭头绑定见 [Page 与 Board](page-surface.zh-CN.md)。

`surfaceViews[surfaceId]` 包含 initial、saved（id/name/targets）与 readingOrder。目标属于对应容器。个人滚动、相机、选中状态保存在本机，不改变内容 hash。

外层可选 `presentation: spatial|reading` 控制显示投影；`selection:{blockIds}` 标识局部内容及必要祖先。`components` 包含固定运行代码，`remoteComponents` 保存已验证网址。元数据包括时间、图标、封面、parentId、收藏、归档与评论。受控写入需要当前语义 hash 和资源 revision。

旧格式读取不重写；首次受控升级保留 `migrations/<resource-id>/original-v1.json` 或 original-v2.json 与已有快照，已迁移资源拒绝降级覆盖。

## 绘画与正文

绘画节点为 `drawing`，attrs 包含 id/name/tool/color/strokeWidth/extent/points。工具支持 pen、rectangle、ellipse、arrow；颜色为六位十六进制，线宽 0.5–40，点数 2–20,000。布局记录显示位置和尺寸，移动不重写局部点位。绘画属于 Board；在 Page 中使用时放入 Board 模块。

普通树节点使用 `{type,attrs?,content?}`，文本使用 `{type:"text",text,marks?}`。空段落用 `content:[]`；空文本节点无效。

| 类型                                       | 结构                                                 |
| ------------------------------------------ | ---------------------------------------------------- |
| paragraph / heading                        | 行内 text/hardBreak；heading level 为 1–3            |
| bulletList / orderedList                   | listItem；有序列表可设 start 和标记 type             |
| listItem / taskItem                        | 首项为段落，可含后续区块；taskItem 有 checked        |
| taskList                                   | taskItem 列表                                        |
| blockquote / callout / toggle              | 嵌套区块；callout 有 icon/tone，toggle 有 title/open |
| codeBlock                                  | 纯文本，可设 language；编辑与阅读时按语言显示语法高亮     |
| horizontalRule / image                     | 无子内容；image 有 src/alt/title 和可选尺寸          |
| table / tableRow / tableCell / tableHeader | 表格行与单元格；支持 colspan/rowspan/colwidth/align  |
| widget                                     | 无子节点，使用 attrs.kind 与 attrs.data              |

代码块使用 Lowlight 的常用语言语法，覆盖 JavaScript、TypeScript、Python、JSON、SQL、Bash、HTML/XML、CSS 等。支持 `js`、`py`、`html` 等别名，忽略大小写；未设置、未知语言和 `plaintext` 按纯文本显示。语法高亮只影响显示，保存的代码仍是未格式化的原文，导出页面也遵循这一规则。

文本 marks 包括 bold、italic、underline、strike、code、highlight、link 与支持的 textStyle。链接允许 HTTP(S)、mailto、tel 或锚点；highlight 可指定 color 和 lower/full 模式。拒绝 JavaScript URL 与任意 HTML。

## 内置组件

```json
{
  "type": "widget",
  "attrs": {
    "kind": "chart",
    "data": {
      "title": "平方函数",
      "type": "line",
      "labels": ["0", "1", "2"],
      "series": [{ "name": "y=x²", "values": [0, 1, 4], "color": "#547c63" }]
    }
  }
}
```

下列为说明性结构；以精确组件 schema、参数和 examples 为准。

| kind                              | 主要数据与限制                                                          |
| --------------------------------- | ----------------------------------------------------------------------- |
| text                              | content、format（markdown/plain）；可混写标题、列表、代码等             |
| image                             | src、alt、caption、width/height、fit                                    |
| table                             | columns 字符串数组、矩形标量 rows；1–100 列、最多 1,000 行              |
| callout / toggle / divider / code | 文本、折叠、分隔线与代码；旧内容保持兼容                                |
| chart                             | line/bar、labels、series；最多 500 标签、20 序列，数值有限且长度对应    |
| database                          | columns、rows、可选 groupBy；最多 50 列、5,000 行，ID 唯一              |
| metrics                           | items 的 label/value/unit/detail/trend；最多 100 项，trend 按百分比显示 |
| playground                        | inputs、sum/product/average、resultLabel；最多 30 输入，min<max、step>0 |
| gallery                           | columns（1–3）、images；最多 100 图、ID 唯一                            |
| bookmark                          | title/description/url、可选 image                                       |

外观参数包括 color/backgroundColor/fontSize/align/padding/radius。数据库阅读支持搜索、筛选、排序、表格/看板切换与 CSV 下载；CSV 会转义可能作为公式的文本。指标未知时留缺项；图表必须使用有来源的数据或明确标注的场景/数学数值。Playground 不执行任意代码公式。

G2、思维导图和图形组件各有自己的参数说明。所有组件使用统一目录与页面写入流程。

## 自定义 React 组件

包包含 manifest.json、props.schema.json、React 入口及资源。manifest 定义 id/name/version/description/scenarios/entry/defaultData/examples 与版本化 documentation。页面引用格式：

```json
{
  "type": "widget",
  "attrs": {
    "kind": "custom",
    "data": {
      "componentId": "value-slider",
      "version": "1.0.0",
      "props": { "label": "Value", "value": 30, "min": 0, "max": 100 }
    }
  }
}
```

ID 使用小写字母、数字与连字符，version 为精确语义版本，写入时锁定 integrity。props 必须通过对应 schema。节点中的任意 JavaScript 字符串不会定义渲染器。

React 默认导出接收 `{data,onChange?,readOnly}`，编辑通过 onChange 回传；阅读态可用本地状态探索，不持久写入。包版本不可变，修改源码要创建新版本。

有对话的宿主还会传入 `onContext` 与 `context`。读者点击「交给对话」等操作时，组件调用 `onContext({model, private?, label?})` 交出当前探索状态：`model`（JSON，不超过 8 KiB）随下一条消息让 Agent 看到，`private` 只返回给同一组件实例，`label`（不超过 80 字）显示在标签上，整份快照不超过 16 KiB。交出成功返回 `true`，没有刚发生的用户操作时返回 `false`，快照无效时抛出错误。工作台把它作为可删标签放进内置 Agent 输入框，MCP Apps 宿主经 `ui/update-model-context` 收到；都不会保存页面、发送消息或启动 Agent。等待发送期间，重新挂载的实例会从 `context` 取回它。导出 HTML、预览和没有对话的宿主不提供 `onContext`，组件只在它存在时显示该控件。探索状态不属于 props schema。

支持 React、包内模块、`showai:components` 与声明了精确依赖的 `showai:component/ID`。不开放任意 npm 包。父组件运行代码包含子组件；目录注册与发布同时保留精确源码依赖闭包。

普通 HTML 与桌面通过 `sandbox="allow-scripts"` iframe 渲染组件，无法使用桌面桥、文件系统或外部网络。导出组件包含 id/version/schema/html/integrity 和可选 inline script/styles；这些是编译产物，不应手写。仅编译包可导入渲染，源码编辑需要补回已验证原始包。

## 对话阅读器

inline 用 `data-showai-inline-root` 标识根，在宿主整页沙盒中使用组件 inline 运行代码和 Shadow DOM 样式；组件 JavaScript 共享该页执行上下文。不会从任意组件 HTML 提取执行脚本。旧包缺少 inline 编译产物时需要以新版本补入源码。存在桌面桥时不启用此模式。

阅读器按当前页面使用的内置组件及依赖编译，G2 仅带所选绘图函数，公共运行时代码合并一次。整站对活跃页面取并集并共享阅读器。旧软件或指定 viewer 模板可能仍使用 prebuilt 策略，查询 runtime info.readerCompilation。

对话预览优先使用本地阅读器与依赖，必要时整体无损 gzip 压缩；伴随源 JSON 保持完整。最终 UTF-8 上限为 1,000,000 字节。超限时选择有意义的局部节点并交付完整页面。

发布阅读器按应用版本和内容 hash 固定身份。在线回退依次尝试 ShowAI 阅读器源、jsDelivr、unpkg；1.5 秒启动备选，15 秒报告失败，只挂载一次。`reader:cdn` 或 `--reader cdn` 显式选择在线；`reader:bundled` 或 `SHOWAI_READER_CDN=off` 禁用在线回退。HTML 默认离线，站点共享内嵌资源。在线模式需要网络并在宿主 CSP 中声明来源。

## 导出与校验

```sh
node dist-runtime/scripts/cli.mjs export --project PROJECT --page PAGE --format html --out ./report.html --json
node dist-runtime/scripts/cli.mjs export --project PROJECT --page PAGE --format inline --out ./report-inline.html --json
node dist-runtime/scripts/cli.mjs export --project PROJECT --format site --out ./site --json
```

HTML/inline 同时保存 `.showai.json`。page_present 的 HTML/source 完整，blockIds 仅选聊天预览；page_export/CLI blocks 生成局部 HTML 和局部源。静态站点用于 HTTP 托管，单文件 HTML 可直接离线打开。

图片必须内嵌为 PNG/JPEG/GIF/WebP/AVIF。浏览器导出可下载并内嵌远程图片；来源拒绝访问、格式不支持或超限时明确失败。SVG、可执行 URL 和相对/file 图片路径不允许。源链接被点击时仍需网络。独立渲染器可使用 `npm run artifact -- examples/welcome.showai.json artifacts/welcome.html`；自定义组件需随源带编译包，项目导出会自动解析。

当前结构 JSON 上限 16 MiB（不计完整规范 data URL 的二进制正文）；单资源 64 MiB，每页去重资源总量 128 MiB；完整 artifact JSON 与单文件 HTML 各 256 MiB。最多 12,000 节点、48 层 JSON。以 `showai_capabilities.capacities` 为准。非法树、未知节点、错误 marks、不安全 URL、非有限数与原型污染键被拒绝；未知 widget 保留原 JSON 并显示后备内容。

远程组件 locator 包含精确 ref、bundleRef、url/sha256/bytes、manifestUrl/manifestIntegrity/verifiedAt。必须使用发布校验返回的引用；读取时同时检查传输摘要和包身份。除 loopback 开发用途外要求 HTTPS，跨域托管需要 CORS。下载或校验失败保留原页面。inline 要求 bundled 组件。

阅读器不带遥测、后台账号连接或自动 API。自定义组件通过明确的可执行包机制运行，其边界按以上模式区分。详见 [组件与模板](catalog-lifecycle.zh-CN.md)。

# Page 与 Board 的读取

使用已核实的 MCP 连接与 projectId。先查 `showai_capabilities.boardReading`、`guide({topic:"reading"})` 与实际工具 inputSchema。工具缺失表示运行时或宿主能力尚未更新，安装说明文件不会自动升级 App。

## Board 默认看图

理解 Board 时先调用 `board_read({projectId,pageId,boardId?})`。pageId 是保存资源 ID；资源根是 Board 时可省略 boardId，嵌入 Page 的 Board 用其稳定节点 ID。小画布返回清晰全图，大画布返回最长边 1200 像素的总览与重叠裁切图。窗口为 1600×1600、重叠 200 像素；scale 调整截图分辨率。图片以 MCP 图像附件返回，imageKey、attachmentIndex、pixelSize、bounds、imageToBoard 说明附件和画布坐标的对应关系。

保留 snapshotId。一次至多八张图；coverage.nextCursor 非空时用相同 snapshotId、mode:visual 和 cursor 继续。仅省略空窗口，coverage 保留完整网格、占用区间与空窗数；需要空窗时可显式读取。pageIndex 枚举包括隐藏正文在内的嵌套 Page，pageCoverage.nextOffset 用 pageOffset 继续。每张裁切图附 elementIndex，稳定 nodeId 不随裁切变化；长索引用 elementOffset 继续。

```json
{ "projectId": "项目ID", "pageId": "资源ID" }
```

## 沿同一张图细读

以下查询都使用首读返回的 snapshotId 与资源 pageId：

- `board_read({snapshotId,mode:"tile",tileIds:["T1"]})` 只返回指定裁切图。
- `board_read({snapshotId,mode:"region",tileId:"T1",pointPx:{x:420,y:300}})` 用图像像素找候选元素并截图；rectPx 可替代 pointPx。候选可能有重叠对象，按 nodeId 再查。像素输入始终对应原裁切图分辨率；scale 只提高细节截图分辨率。超过单图尺寸时缩小 region。
- `board_read({snapshotId,mode:"element",nodeId:"对象ID",detail:"both",tileId:"T1"})` 验证元素出现在 T1 中，返回整个对象外框的截图与完整原始节点；大对象图像分页。只看 T1 内的局部用 mode:region。detail:source 只读源。
- `page_read({snapshotId,blockIds:["Page节点ID"],rendered:false,response:"source"})` 读取该 Page 完整正文和原始组件数据，包含其外框之外的内容。截图保持 Page 当前可见范围；原始正文不受外框裁切。省略 blockIds 可读整个保存资源。
- `board_read({snapshotId,mode:"source"})` 返回 Board 格式化原始子树、layout、surfaceViews、父路径与外部连接引用；画笔保留 points、extent、颜色和粗细，组件保留原始 props。

```json
{
  "projectId": "项目ID",
  "pageId": "资源ID",
  "snapshotId": "首读返回的ID",
  "mode": "element",
  "nodeId": "Page节点ID",
  "tileId": "T1",
  "detail": "both"
}
```

快照将原始数据、组件精确引用与实际渲染状态固定在同一次捕获中，有效期 30 分钟；过期返回 SNAPSHOT_EXPIRED，重新首读。currentSourceChanged 标记保存资源是否在捕获后变化，旧图与旧数据仍对应。origin:saved 表示按已保存源渲染，provided-draft 表示显式 draftDocument；默认不会读取正在编辑的 App 实时状态。可显式 state.cameras/pageScrolls 指定嵌套视口与滚动。warnings 报告不可用组件；位图、canvas 与视频帧保留捕获时分辨率，矢量和文字支持重新放大。读取不保存正文。局部结果不能覆盖整页；编辑前重新 page_read 完整当前源，使用当前 hash/revision。

## 普通 Page 与交互

普通 Page 内容分析和编辑使用 structured；format:markdown 用于正文与组件数据。长页先 detail:outline，再用 blockIds 选择局部，纯源用 rendered:false。

颜色、布局、遮挡用 page_read 的 view:image，指定 viewport/theme 并保留 hash、组件引用和状态；交互用 view:html，先读真实可访问性快照，再按控件实际名称操作。actions 可重放 hover、click、fill、select、check、uncheck、drag；控件不存在或重名会报错。不同状态对比保持同一宽高和源版本。正式宿主交互验收遵循当前任务的官方浏览器/电脑操控规则，自动化读图与读取 HTML 源码不能代替操作验收。

rendered 读取生成文件与 .read.json 记录来源和状态。本机连接传 `out:"/绝对路径/文件"` 时，结构化源（JSON 或 markdown）、image 的 PNG 或 html 写入该文件，回执只含 out（path、bytes、sha256）与 hash、revision（页面有绑定块时还带 datasetBases，键就是共享数据 id，可直接用于 dataset_read），不再把整页或图片放回对话；已有文件需加 overwrite:true。结构化源文件含 document、outline、computed（rendered:false 时为空），以及绑定块的 bindings（解析后的 props）与 datasetBases，内容不受 response 影响；共享数据本身另用 `dataset_read` 的 out 写出。draft:true 只在临时预览编辑，不写入正式 Page；computed.props 是预览数据。声明 manifest.reader=readData 的组件可返回同步派生数据，保留原始 props，按稳定 ID 核对 computed.data。渲染需要运行时浏览器与组件编译能力；缺失时明确报告，JSON 可读不能证明视觉通过。

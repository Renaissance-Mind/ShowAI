# Page 与 Board

Page 是顺序排版的页面，适合文档、报告和网页；Board 是空间型白板，支持平移、缩放、绘画与自由摆放。新建内容默认 Page，也可以直接创建 Board。两者都是原生容器，可以递归嵌套，展开后继续编辑同一个节点。

Page 和 Board 与 Markdown、图片、图表等一起列在组件库中，支持搜索、预览和插入。编辑区使用 `/` 菜单直接搜索并插入所有组件；Page 和 Board 插在光标所在位置，前后文字与嵌套位置保持完整。白板空白处按 `/` 使用同一组件目录，页面末尾可继续在普通空白段落输入。新增内容不再提供顺序、网格、自由分组三种独立菜单项；已有分组继续可编辑和调整布局。

## 内容与外框

父级决定模块的位置和外框，子容器决定内部布局。Page 的子节点按内容顺序排列，Board 的子节点使用相对所属容器的坐标。流式、网格和自由分组仍使用 `region`，分组自身不创建新的视口。

Page 中的 Board 默认使用固定高度窗口，内部绘画不会撑开文章。Board 中的 Page 默认使用固定阅读窗口，可以在其中上下阅读，也可以展开。Page 外框可在模块设置中改为随内容增长。

工作区顶部的内容层级显示当前展开路径。「返回上层」恢复父级视图。通过外框手柄移动整个模块，通过文字或内部控件编辑内容。所有层级共享一个资源文件、保存机制和内容历史；跨容器移动、删除、绘画和包裹都可以撤销。

## 交互

| 操作                            | 行为                                     |
| ------------------------------- | ---------------------------------------- |
| 阅读 Page                       | 原生纵向滚动、文字选择、键盘与输入法     |
| 在锁定的 Board 模块上滚动       | 继续阅读外层 Page，内部视图保持位置      |
| 点击右上角的锁定图标            | 切换锁定状态，解锁后可缩放、平移和绘画   |
| Board 左右滑动                  | 可见弹性阻力，手势停止后回弹或轻微吸附   |
| Board 空白处、中键或空格拖动    | 平移；编辑文字时空格用于输入             |
| Board 捏合、Ctrl/Command + 滚轮 | 围绕指针缩放，坐标经过父级缩放换算       |
| 画笔、矩形、椭圆、箭头          | 在所属 Board 的本地坐标中创建绘画节点    |
| 外框展开                        | 在更大工作区编辑同一节点，保留归属和 ID  |
| Escape                          | 先取消当前绘画/操作，再退出当前层级      |
| 撤销、重做                      | 恢复内容和结构；元数据与个人视图独立处理 |
| 放入 Page / 放入 Board          | 增加对应外层容器，原节点成为其子节点     |

嵌套的 Page、Board、表格、代码区和组件拥有明确的输入边界。已开始的手势由同一层处理到结束。自定义组件可通过 `GestureBoundary` 声明所需的轴；iframe 内部继续由其自身接收事件。

Board、流程图与 G2 图表右上角提供阅读锁，首次显示时默认锁定。锁定时禁止缩放、平移、节点拖动和改变视图的拖拽手势，点击、右键、提示、内容展开和编辑控件继续工作。解锁后恢复对应的浏览与拖动功能。每个实例的锁定状态保存在本机个人视图存储中，重开页面后恢复；同一 Board 的嵌入与展开视图共享锁定状态。沙盒组件由宿主保存状态并转交阅读滚动。独立导出的不透明沙盒无法使用持久存储时仍可临时切换，图标提示保存失败。

白板动效沿用连续的阻力和阻尼弹簧，可以被新输入打断。减少动态效果偏好保留跟手位移，直接完成回位。绘画的指针捕获与白板平移分开，绘画期间不会同时移动相机。

## 版本 3 模型

```json
{
  "format": "showai",
  "version": 3,
  "document": {
    "id": "research",
    "title": "研究报告",
    "content": {
      "type": "surface",
      "attrs": { "id": "report", "kind": "page", "name": "报告" },
      "content": [
        {
          "type": "paragraph",
          "attrs": { "id": "intro" },
          "content": [{ "type": "text", "text": "问题、材料与解释。" }]
        },
        {
          "type": "surface",
          "attrs": { "id": "analysis", "kind": "board", "name": "分析白板" },
          "content": [
            {
              "type": "surface",
              "attrs": { "id": "evidence", "kind": "page", "name": "详细论证" },
              "content": [
                {
                  "type": "paragraph",
                  "attrs": { "id": "detail" },
                  "content": [{ "type": "text", "text": "这里继续顺序阅读。" }]
                }
              ]
            }
          ]
        }
      ]
    },
    "layout": {
      "analysis": {
        "x": 0,
        "y": 0,
        "width": 800,
        "height": 460,
        "heightMode": "fixed"
      },
      "evidence": {
        "x": 80,
        "y": 60,
        "width": 600,
        "height": 380,
        "heightMode": "fixed"
      }
    },
    "surfaceViews": {
      "report": {
        "initial": null,
        "saved": [],
        "readingOrder": ["intro", "analysis"]
      },
      "analysis": {
        "initial": null,
        "saved": [],
        "readingOrder": ["evidence"]
      },
      "evidence": { "initial": null, "saved": [], "readingOrder": ["detail"] }
    }
  }
}
```

包括根容器在内的非文本节点具有唯一稳定 ID。`surface.attrs.kind` 为 `page` 或 `board`。`layout` 保存父级赋予子节点的外框；根容器没有父级外框。位置范围为 ±1,000,000，普通模块宽度 120–10,000；绘画节点可以更小。`heightMode: auto` 只适用于 Page。分组的 `mode`、`columns`、`gap` 保持 flow/grid/free 约定。

`surfaceViews` 按容器 ID 保存命名视图、初始视图和阅读顺序。视图目标必须属于该容器。Page 的阅读顺序就是内容树顺序；Board 的阅读顺序供线性导出使用。个人滚动、相机、选择和展开状态保存在本机，不改变内容 hash。

绘画节点使用 `drawing`，属性包含 `tool`、六位十六进制 `color`、`strokeWidth`、`extent: [width,height]` 和本地 `points: [{x,y}]`。其位置和显示尺寸仍在 `layout` 中，放大缩小父级不会改写笔画点位。

## Agent、模板与导出

`showai guide containers --json` 提供完整约定。新建可用 `pages create --kind page|board`。插入组件使用 `component.insert`，Page/Board 与普通组件共用同一入口；原生容器仍保存为 surface 节点。`surface.create` 在指定父级加入容器；`surface.wrap` 包裹当前根或某个容器；通用区块操作保留内容身份。视图操作通过 `surfaceId` 定位所有者，省略时作用于根。受控修改始终要求当前 base hash。

模板完整保存嵌套树、外框和各层视图。实例化时一起重建所有身份及引用，加入现有页面时作为原生模块插入。局部导出可以选择任意容器，包含其后代和必要祖先；源资源保持原样。

独立网页保留 Page 阅读、Board 浏览和逐层展开。`--presentation reading` 将所选根 Board 按阅读顺序呈现。打印保留嵌入 Board 的空间关系并适配可打印宽度；Board 中的 Page 保留外框窗口，可单独选择该 Page 导出完整阅读内容。会话片段超过体积预算时会压缩阅读器代码，源 JSON 仍保持完整明文；解压和运行均在本机完成，总体积限制保持不变。

## 兼容

v1 普通文档在内存中映射为 Page；含旧浮动内容的文档和 v2 白板保留为空间型 Board。读取不会重写文件。首次受控保存到新版本时，在 `migrations/<resource-id>/original-v1.json` 或 `original-v2.json` 保存原始字节，并保留历史快照。已迁移资源不允许用较旧格式直接覆盖。

# Page 的三种读取视图

使用已核实的MCP连接与projectId。通过guide({topic:"reading"})和page_read的inputSchema确认当前支持的参数。

内容分析和编辑默认structured；format=markdown用于正文与组件数据。长页先detail=outline，再用blockIds选择局部。局部结果有partial标记，不能作为整页覆盖输入；纯源读取用rendered=false。

颜色、布局、遮挡使用view=image；指定viewport与theme，查看返回PNG并保留hash、组件引用及状态。交互使用view=html，先读实际可访问性快照，再按控件真实名称操作。正式宿主交互验收遵循当前任务的官方浏览器/电脑操控规则，自动化读图不能代替这些要求。

```json
{"projectId":"项目ID","pageId":"页面ID","view":"image","viewport":{"width":1000,"height":900},"theme":"light"}
```

rendered读取生成的文件与.read.json记录来源和状态。draft=true只在临时预览编辑，不写入正式Page；computed.props是预览中的临时数据。需要保存时使用完整Page当前hash/revision，再page_apply或page_save。

运行时支持的actions可以重放hover、click、fill、select、check、uncheck、drag；实际参数以工具schema为准。控件不存在或重名应报错。不同状态对比保持同一宽高和源版本。不要把读取HTML源码当作操作验收。

声明manifest.reader=readData的组件可返回同步派生数据。保留原始props，按稳定ID核对computed.data。渲染需要运行环境的浏览器与组件编译能力；缺失时说明实际限制，不能以JSON可读声称视觉通过。

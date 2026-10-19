# 组件设计与验证

用 MCP 的 `guide({topic:"component"})` 获取当前命令与结构；组件 schema 和示例由目录动态返回。

新组件使用 documentation.version=2；按 [参数契约](parameter-contract.md) 同步 schema、字段语义、遗漏行为、示例及关系约束。结构检查与实际交互分别验证，不把例子中的初始值称为自动默认值。

定义数据契约：输入字段、必填条件、数组上限、单位、默认值以及空数据状态。schema 与 defaultData、examples、React 入口一致。界面需要的计算与状态说明保持在组件内；正式数据通过 `onChange(nextData)` 返回，读取态保持页面源数据。每个组件接收 `{data, onChange, readOnly}`。

包包含 `manifest.json`、`props.schema.json` 和 manifest.entry 指定的本地文件。manifest 记录 id、name、version、description、scenarios、entry、defaultData、examples。输入与示例保留可用的最小实例；参考本次真实内容验证较复杂情况，不为未知事实生成示例测量。

组件需要专门的制作流程时，先读 `catalog_describe(view="guide")` 返回的 `authoringReference`。它沿用该组件的 scope、version、integrity，并指向源码包中的制作索引。documentation.version=2 可用 `authoring.entry` 声明索引文件；索引、完整指南及制作文件随组件版本保存，引用和指南 SHA-256 在保存时校验；索引与指南的完整结构由 guide component 的 authoringIndexSchema、authoringGuideSchema 返回。本地自编说明可省略上游来源和渲染程序字段，不编造仓库或提交。按索引逐份读取共享规范、所选类型或风格指南、输入 Schema 和例子，避免仅替换模板文字后就宣称完成了新的图形内容。

Archify、Diagram Design 和 Fireworks 技术图带有固定上游提交的完整制作指南与原版制作包。读取它们的 `authoring/index.json` 后，按所选流程保存 `authoring/kit.json`、`authoring/run.mjs`、`authoring/diagram-authoring-fonts.mjs` 和 `authoring/font-licenses.json`，使用索引中的实际命令。Archify 3.1 的十类 JSON 输入（architecture、workflow、sequence、dataflow、lifecycle、erd、class、tree、timeline、waterfall）与 Fireworks 的十一种生成风格使用包内原版渲染程序；Diagram Design 和 Fireworks style 8 按原版绘图规范制作 SVG/HTML。将结果的 data 写入组件或导入输出文件；完整原稿保存在 source，presentation 仅控制标题、说明、图例与阅读控件的显示。比较上游结果时使用原版呈现。字体与图标按原规范本地嵌入；字体辅助程序只查询字体家族，内容字形在本地选择。原项目的浏览器检查命令属于参考流程，界面交互仍遵循当前宿主的官方浏览器入口；程序校验与实际视觉检查分别记录。

组件有汇总或计算字段时，可在 manifest 声明 `reader: "readData"`，并从入口命名导出同步 `readData(props)`。返回不超过 64 KiB 的 JSON，以稳定 ID 对应源数据并标明派生字段。它与组件使用同一份计算逻辑，在浏览器沙箱中执行；数据读取不访问文件或服务。Agent 的 structured 视图保留原始 props 与 computed.data，image/html 使用同一固定版本。增加或修改读取模型后用 component_save 保存新版本，并验证原始字段与计算值一致。

`readData(props)` 的参数就是组件收到的 `data`，即页面引用 `data.props` 中的实例数据。读取结果把返回值作为 computed.data 与原始 props 分开提供，因此只需返回派生值，用稳定 ID 对应源数据，不必复制原始字段；返回值只能包含有限的 JSON 值。用 page_read 的 structured 视图读取 computed.data 时不要传 rendered:false；含 readData 的组件会自动渲染。

先复用 `showai:components` 的基础元素与已提供控件，包括 Flowchart、Video、Audio、PDF 和 References。RichText 是统一富文本组件，App 正文、组件插入与 AI 写入复用同一模型、渲染和组件自带菜单；数据首选 format=richtext 与 doc 内容树，旧 Markdown/Text 导出名和字符串输入保留兼容。文字设置、选中、悬停与表格操作在富文本组件内部定义，宿主提供项目资源与内容保存。组件自带行内与行间 LaTeX 渲染；不要为公式另写渲染器。文件组件在自定义组件沙箱中使用对应 MIME 的 base64 data URI，在线地址只能用于工作台中的原生内置组件；沙箱保持禁止外部请求。本机的大文件（如视频原片）不必内嵌：用 `<a href="file:///绝对路径">` 或 `file:~/相对主目录的路径` 链接它，读者点击后由 ShowAI 工作台的播放器打开视频、音频和图片，其他类型可在文件夹中显示；组件拿不到文件内容，导出的 HTML 中只显示位置。链接的点击事件需要冒泡到文档，不要在链接或其外层调用 stopPropagation。自定义子组件通过 `showai:component/ID` 导入，并在 manifest.dependencies 声明目录返回的完整版本和指纹。允许 React、ShowAI SDK 与包内模块；任意 npm 包和远端脚本不是组件导入接口。需要新的外部库时，将依赖接入 ShowAI 软件运行时并完成离线验收，再向组件暴露明确能力。

## 菜单与交互入口

明确操作作用于文字选区、节点、组件数据还是外层容器，检查这个对象已有的选中、右键、悬停菜单及设置面板。新动作优先加入对应入口，沿用其位置和开关逻辑；通用格式设置在前，当前对象的专属动作在后。同一对象在同一触发点保持一个菜单容器。用户明确指定入口位置或交互方式时，按其要求实现并复用动作逻辑。自行新增入口时，根据用户任务说明现有入口缺少什么，并选择合理的位置。

按已经出现的重复提取共享动作、菜单容器、定位函数或局部 hook。可以先完成局部抽象，再随实际需求扩展；具体名称、接口与组合方式按当前组件及宿主能力决定。使用 `guide({topic:"component"})`、组件源码和实际 SDK 导出确认可调用能力；本轮所需的共享实现要位于可用的模块或包内，文档描述的目标行为与当前已公开的接口分别说明。宿主尚无菜单扩展接口时，先评估组件内部已有动作容器能否承载这次功能。

同一动作出现在不同入口时，共享可用条件、状态和执行逻辑。选中菜单与右键菜单切换时保留目标与选区，并让暂时不使用的菜单让位；悬停操作避免同时覆盖它们。菜单根据当前对象和实际尺寸定位，在滚动、缩放、窄视口和嵌套容器中保持可用。阅读、缩放、翻页及计算输入等内容交互按读者任务组织。

在真实页面分别验证涉及的选中、右键、悬停状态，以及动作顺序、选区与焦点、键盘和 Escape、菜单互斥、滚动和边缘遮挡。检查只读与导出模式保留读者需要的内容交互，编辑动作正确隐藏或禁用；正式数据修改继续通过宿主的 `onChange(nextData)` 保存。

测试实际结果：必填或非法数据应给出明确错误；编辑操作应产生有效的新数据；读取态交互可以探索但不保存正文；导出 HTML 应可用；宿主支持对话呈现时再检查该模式，否则明确其未验证范围。颜色、字号、节点标签与控制项在实际容器中可读。自定义画布要提供可访问的文字描述与键盘操作。

项目路径验证 Page 的 structured、image 和 html 视图；独立路径检查保留的源 document/源码包、渲染回执和导出阅读器。宿主缺少图像或浏览器检查能力时，完成可做的数据与编译检查，并明确未验证的视觉/交互范围，不要求为此创建项目。项目读取时：计算结果按 ID 可追溯，图像包含真实组件，交互动作能找到目标并产生预期状态。临时 draft 预览不改写源 Page；正式编辑仍通过宿主的 onChange 保存。

## 阅读任务的验证

机制组件保持稳定对象与状态身份，变化、继承和固定条件使用可解释的编码；比较组件保持共同维度、缺项和来源。空态、筛选无结果、输入更新后的失效选择、恢复操作和静态展开属于同一阅读任务。避免仅添加通用缩放或折叠后就声称支持机制理解或条件比较。

嵌入组件中的阅读面板要在实际宿主里检查可见性和焦点恢复。自动增高的 iframe 与宿主视口高度不同；固定定位或弹窗可能落在当前屏幕外。详情较长时优先使用组件内的视图切换，并在返回时恢复选择与焦点。只检查顶层页面中的组件，不能证明嵌入后同样可用。

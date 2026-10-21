# 组件设计与验证

用 MCP 的 `guide({topic:"component"})` 获取当前命令与结构；组件 schema 和示例由目录动态返回。

新组件使用 documentation.version=2；按 [参数契约](parameter-contract.md) 同步 schema、字段语义、遗漏行为、示例及关系约束。结构检查与实际交互分别验证，不把例子中的初始值称为自动默认值。

定义数据契约：输入字段、必填条件、数组上限、单位、默认值以及空数据状态。schema 与 defaultData、examples、React 入口一致。界面需要的计算与状态说明保持在组件内；正式数据通过 `onChange(nextData)` 返回，读取态保持页面源数据。每个组件接收 `{data, onChange, readOnly}`；有对话的宿主还会传入 `onContext` 与 `context`，见下方「交给对话」。

包包含 `manifest.json`、`props.schema.json` 和 manifest.entry 指定的本地文件。manifest 记录 id、name、version、description、scenarios、entry、defaultData、examples。输入与示例保留可用的最小实例；参考本次真实内容验证较复杂情况，不为未知事实生成示例测量。

组件需要专门的制作流程时，先读 `catalog_describe(view="guide")` 返回的 `authoringReference`。它沿用该组件的 scope、version、integrity，并指向源码包中的制作索引。documentation.version=2 可用 `authoring.entry` 声明索引文件；索引、完整指南及制作文件随组件版本保存，引用和指南 SHA-256 在保存时校验；索引与指南的完整结构由 guide component 的 authoringIndexSchema、authoringGuideSchema 返回。本地自编说明可省略上游来源和渲染程序字段，不编造仓库或提交。按索引逐份读取共享规范、所选类型或风格指南、输入 Schema 和例子，避免仅替换模板文字后就宣称完成了新的图形内容。

Archify、Diagram Design 和 Fireworks 技术图带有固定上游提交的完整制作指南与原版制作包。读取它们的 `authoring/index.json` 后，按所选流程保存 `authoring/kit.json`、`authoring/run.mjs`、`authoring/diagram-authoring-fonts.mjs` 和 `authoring/font-licenses.json`，使用索引中的实际命令。Archify 3.1 的十类 JSON 输入（architecture、workflow、sequence、dataflow、lifecycle、erd、class、tree、timeline、waterfall）与 Fireworks 的十一种生成风格使用包内原版渲染程序；Diagram Design 和 Fireworks style 8 按原版绘图规范制作 SVG/HTML。将结果的 data 写入组件或导入输出文件；完整原稿保存在 source，presentation 仅控制标题、说明、图例与阅读控件的显示。比较上游结果时使用原版呈现。字体与图标按原规范本地嵌入；字体辅助程序只查询字体家族，内容字形在本地选择。原项目的浏览器检查命令属于参考流程，界面交互仍遵循当前宿主的官方浏览器入口；程序校验与实际视觉检查分别记录。

组件有汇总或计算字段时，可在 manifest 声明 `reader: "readData"`，并从入口命名导出同步 `readData(props)`。返回不超过 64 KiB 的 JSON，以稳定 ID 对应源数据并标明派生字段。它与组件使用同一份计算逻辑，在浏览器沙箱中执行；数据读取不访问文件或服务。Agent 的 structured 视图保留原始 props 与 computed.data，image/html 使用同一固定版本。增加或修改读取模型后用 component_save 保存新版本，并验证原始字段与计算值一致。

`readData(props)` 的参数就是组件收到的 `data`，即页面引用 `data.props` 中的实例数据。读取结果把返回值作为 computed.data 与原始 props 分开提供，因此只需返回派生值，用稳定 ID 对应源数据，不必复制原始字段；返回值只能包含有限的 JSON 值。用 page_read 的 structured 视图读取 computed.data 时不要传 rendered:false；含 readData 的组件会自动渲染。

先复用 `showai:components` 的基础元素与已提供控件，包括 Flowchart、Video、Audio、PDF 和 References。RichText 是统一富文本组件，App 正文、组件插入与 AI 写入复用同一模型、渲染和组件自带菜单；数据首选 format=richtext 与 doc 内容树，旧 Markdown/Text 导出名和字符串输入保留兼容。文字设置、选中、悬停与表格操作在富文本组件内部定义，宿主提供项目资源与内容保存。组件自带行内与行间 LaTeX 渲染；不要为公式另写渲染器。需要悬停注释时，用 `showai:components` 的 `NoteText` 渲染可能含 `[可见文字]{注释}` 的文字字段（SVG 内用 `NoteSvgText`），或把 `noteProps(注释)` 展开到任意元素上；公式里的 `\note{变量}{注释}` 由 LaTeX 渲染自动处理。气泡显示、键盘聚焦和触屏轻点由宿主统一提供，组件不要另写提示框。文件组件在自定义组件沙箱中使用对应 MIME 的 base64 data URI，在线地址只能用于工作台中的原生内置组件；沙箱保持禁止外部请求。本机的大文件见下方「本机文件」。自定义子组件通过 `showai:component/ID` 导入，并在 manifest.dependencies 声明目录返回的完整版本和指纹。允许 React、ShowAI SDK 与包内模块；任意 npm 包和远端脚本不是组件导入接口。需要新的外部库时，将依赖接入 ShowAI 软件运行时并完成离线验收，再向组件暴露明确能力。

**本机文件。** 视频原片等本机大文件不必内嵌，也不受上面的资源预算限制：在组件里放一个普通链接，`href` 写 `file:///绝对路径`，或写 `file:~/相对个人目录的路径`（如 `href="file:~/Movies/clip.mp4"`）。路径各段用 `encodeURIComponent` 编码后再用 `/` 连接并拼到 `file:` 后面，这样空格、中文、`#`、`?` 都能保留。这个能力只属于自定义组件里的链接；内置 Video/Audio 组件的 src 和正文里的链接不接受 `file:`。读者在 ShowAI 桌面版或本机浏览器版（编辑和只读阅读都可以）点击这个链接后，工作台弹出播放器直接打开原文件：支持视频（mp4、m4v、mov、webm）、音频（mp3、m4a、aac、wav、ogg、flac）和图片（png、jpg、gif、webp）；其他类型显示位置，并提供「在文件夹中显示」。组件本身拿不到文件内容，沙箱策略不变。只有 `<a href>` 链接的点击会被宿主接收：不要用 `window.open`、`location` 或按钮脚本代替；不要阻止链接点击的冒泡或默认行为（链接上及其外层处理链接点击时都不要调用 `stopPropagation`、`preventDefault`）；卡片自身的点击处理可先用 `event.target.closest("a")` 判断并跳过链接，与链接无关的点击不受影响。导出的 HTML 不能播放本机文件，点击只显示并可复制文件位置（位置里含本机用户名等信息，分享前留意）；对话内预览中点击没有效果。需要随页面分发的视频改用内置 Video 组件（data URI 嵌入，受页面资源预算，并会使对话预览超限）或在线地址。

## 交给对话

读者在组件里拖滑块、切参数得到的状态默认只留在组件内，Agent 看不到。有对话的宿主（ShowAI 工作台的内置 Agent，以及接受模型上下文的 MCP Apps 对话预览）会额外传入两个属性，让读者主动把这一刻的状态交给对话：

- `onContext({model, private?, label?})`：`model` 是模型可见的 JSON（不超过 8 KiB），随读者下一条消息进入对话；`private` 只返回给同一组件实例，用于恢复滑块位置、视图等，Agent 看不到；`label` 是输入框标签上的短文字（不超过 80 字）。整份快照不超过 16 KiB，只接受有限的 JSON 值，格式错误或超限时抛出错误。调用必须紧随读者的操作（例如点击「交给对话」），否则返回 false；成功返回 true。
- `context`：这个实例仍在对话输入框中等待发送的快照（含 `private`），组件挂载时据此恢复状态；没有时为 undefined。它只在挂载时提供，之后由组件自己维护状态。

宿主行为：工作台把 `model` 作为可删的组件状态标签放进内置 Agent 输入框，第一次交出时打开对话面板，再次交出更新同一标签，读者移除标签后它不随消息发送；MCP Apps 预览经 `ui/update-model-context` 交给宿主，与引用、控件取值合为一份上下文。任何宿主都不会写入页面 props、不会自动发送消息，也不会启动 Agent。导出 HTML、组件预览、缩略图和不接受模型上下文的宿主不提供 `onContext`，此时不显示交给对话的控件。

```jsx
export default function Explorer({ data, onContext, context }) {
  const [gamma, setGamma] = useState(context?.private?.gamma ?? data.gamma);
  const regime = gamma < data.omega ? "欠阻尼" : "临界或过阻尼";
  return onContext ? (
    <button
      type="button"
      onClick={() =>
        onContext({
          model: { gamma, omega: data.omega, regime, changedFromSaved: gamma !== data.gamma },
          private: { gamma },
          label: `γ=${gamma} · ${regime}`,
        })
      }
    >
      交给对话
    </button>
  ) : null;
}
```

交出的是读者此刻看到的状态，不是页面数据：不要为它新增 schema 字段，也不要用 `onChange` 保存它；用户要求保留时由页面编辑流程修改 data。`model` 用稳定字段名和单位写出 Agent 需要的参数、派生量与相对已保存数据的变化，不放整张图或长数组。不要在拖动的每一帧调用，在明确的操作或交互结束时调用一次。在 `usage.interactions` 中把这个操作记为 `persistence: "none"`，effect 写清交出的字段。

验证时在工作台真实页面操作后检查对话输入框出现标签、移除后不随消息发送、刷新页面后 `context` 恢复，并确认页面数据未变；检查导出 HTML 不出现该控件；能接入 MCP Apps 对话预览时检查宿主收到的模型上下文，不能时说明未验证。

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


## Page 原生目录组件

目录组件声明 manifest.role="page-outline"、pageOutlineProtocol=1、category="outline"，通过 Page 的 attrs.outline.renderer 关联精确版本。React 入口接收 props 和 outline（protocol、pageId、items 树、activeItemId、expandedItemIds、container 的 placement/width/height、theme、locale），以及 navigate(itemId)、setBranchExpanded(itemId,expanded)、collapse()。组件负责呈现、分支和可访问性，Page 宿主负责位置、整体收起和目标校验。只读页面仍提供导航动作。作者 props 遵循包自己的 schema；阅读状态使用上述协议，普通 onChange 不参与。

创建或修改后，在 Page 中实际关联并验证导航、当前章节、窗口宽度变化和收起展开；完整契约见 docs/page-surface.md，两个独立示例位于 examples/page-outline-index 和 examples/page-outline-path。

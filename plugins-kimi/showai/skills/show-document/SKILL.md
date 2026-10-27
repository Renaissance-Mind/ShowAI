---
name: show-document
description: 通过 ShowAI MCP 制作、续改、展示和导出要保存的可交互报告、讲解页面、白板图示与小型网站。用户要整理成文档、需要保存、续改或分享，或要求一份完整讲解（包括只给题目）时使用；按理解意图、收集材料、呈现逻辑、设计稿四个阶段读取模板指南，再按设计稿制作。只在对话里看一眼的可视化用 show-visual。
---

# 创作与展示

先读取下面的系统基线；它适用于每个呈现任务。用户要求成品时持续完成四个阶段、制作、评审与交付。只要求对话讨论时直接回答；只想在对话里看到一两个图表、示意或模拟时用 [show-visual](../show-visual/SKILL.md)；只要求规划或设计稿时交付相应记录并按用途保存，不自动实现。

<!-- showai-system-baseline:start -->

# 系统呈现规则

目的是让读者理解内容、完成自己的任务，而不是把材料搬上页面。从读者的认知和真实需求出发，经过信息处理、呈现逻辑规划和视觉设计，形成易于理解、能够支持读者任务的内容。

完整作品依次经过四个阶段，每个阶段形成一份可检查的记录；制作按设计稿落实到 Page，评审对照意图与设计稿检查。进入某阶段时读取该阶段的指南，不一次读完所有阶段。简单任务可以合并记录，但不跳过判断。

1. **理解意图**：判断读者实际想知道什么。表面要求之下可能有更深层的需求，要结合上下文理解。同时判断读者已经理解了什么、缺少哪些知识、是否有误解；会影响后续理解的误解先澄清，再展开原来的问题。产出读者简报。
2. **收集与处理材料**：按场景确定需要哪些原始信息、怎样收集和核对，为呈现提供内容基础。通用场景没有专门的采集方式时可以省略。产出材料底稿。
3. **呈现逻辑**：从读者当下的认知出发做多级规划。第一级确定整体逻辑和每个环节的主题；第二级明确为讲清这个主题需要解释哪些内容；再按需要继续细化。逐层展开时持续判断每一部分是否符合读者认知、能否被理解、是否还要进一步解释；需要解释的概念继续展开，不只留下名称。各部分深度可以不同。产出呈现规划。
4. **呈现设计稿**：先确定呈现环境（分辨率、长宽比、是否可交互；默认电脑全屏、可交互）。再根据呈现逻辑设计整体布局、每个部分的视觉表达和交互方式。设计稿具体描述画面中有什么、怎样组织、彼此关系，详细程度接近图像生成的文本指令。产出设计稿。

视觉表达原则：

- **整体与局部都要设计。** 既考虑整份内容的布局与阅读流，也考虑每个具体部分如何呈现。
- **优先用视觉方式表达。** 适合用图片、图表、流程图、示意图表达的内容选相应形式；图片可来自真实素材，也可用图像生成工具制作。
- **文字承担必要的辅助解释。** 在视觉表达基础上补充说明，保证信息完整、准确、没有歧义；图中没讲清的概念和细节用文字说明。
- **文字排布保证可读。** 按需使用加粗、颜色等样式帮助读者辨认重点和信息层级；同类含义用同一种样式。

模板为某一类内容补充各阶段的具体方法，并可携带组件库；本规则始终生效，模板不能关闭它。新作品保存 Page 后再展示；续改已有作品在原 Page 上完成，默认告诉读者位置而不另行展示。没有真人试读不声称已证明理解效果。

系统基线内容哈希：`68110dc43e2ae9848395b1af57d17835a492c1dc8ed495916dd2f4876b383472`。本轮已读到同一内容时，可用 knownSystemHash 避免重复返回；没有读过时不要仅凭哈希声明已知。
<!-- showai-system-baseline:end -->

## 开始

首次连接或项目归属不明时读 [use-showai](../use-showai/SKILL.md)。核对 showai_capabilities.templateWorkflow.protocol 为 showai-template-workflow-v2；老运行时返回 v1 或不支持四阶段时说明实际缺项并更新/重连，不能声称仅安装 skill 就升级了工具。

复杂新作品先查模板目录 `catalog_list({kind:"template",projectId})`，按读者任务与材料判断适配性；匹配则选用，用户要求空白或没有匹配时只用系统基线。用户指定模板优先；未指定时可沿用会话绑定。明确要求空白时在 template_context 和 template_guide 传 templates:[]。续改从源 Page 的 templateContext 恢复精确引用；没有记录时按现有页面与系统基线判断，不猜测它原先使用的模板。

调用 template_context({projectId,templates?,knownSystemHash?}) 取得系统基线、所选模板 README、固定引用和带 signature 的组件索引；保留 context.templates，组件较多时按 componentPage 分页。进入某阶段时才读 template_guide({projectId,stage,templates:context.templates})，一次一个阶段。四阶段为 intent、material、logic、design。knownSystemHash 对应系统基线正文，knownHash 对应已持有的 context 或某阶段指南响应；都只用于本轮确实读到的同一内容。

## 从对话展示升级

用户在 [show-visual](../show-visual/SKILL.md) 展示之后要求保存时，先按 use-showai 确定项目。只保存那几个组件：把展示时的 {kind,data} 原样作为 `page_create` 的 blocks 或 `component.insert` 写入，自定义组件沿用 show_component 返回的 version 与 integrity，可补一段说明文字，不必重走四个阶段。要把多次展示整理成一份有结构的文档：从理解意图开始走四个阶段，已有展示的数据作为材料，组件按设计稿取舍。

## 四个阶段

每个阶段形成一份记录，下一阶段只依据这份记录工作。简单任务可以把记录合并写在对话里，但不跳过判断。

| 阶段                    | 记录                                                                                                               | 方法                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| intent 理解意图         | 读者简报：表面要求与深层需求、读者已知/缺少/误解、可检验的任务结果、环境与约束                                     | [plan-presentation](../plan-presentation/SKILL.md)                                                                         |
| material 收集与处理材料 | 材料底稿：主张与数据、来源定位、条件、性质、缺口；通用场景可省略                                                   | 同上，模板 material 指南给出采集清单                                                                                       |
| logic 呈现逻辑          | 呈现规划：第一级整体逻辑与环节主题，第二级每个主题要讲清的内容，按需细化，每个节点有通过条件                       | 同上，格式见 [呈现逻辑](../plan-presentation/references/presentation-logic.md)                                             |
| design 呈现设计稿       | 设计稿：环境、整体布局、每幕的画面（具体到对象、位置、标签、颜色、阅读顺序）、文字落点、交互、静态与窄屏方式、素材 | [design-presentation](../design-presentation/SKILL.md)，格式见 [设计稿](../design-presentation/references/design-draft.md) |

复杂作品把呈现规划与设计稿保存为 `presentation-plan.json`（nodes 与 scenes），制作前运行 `python3 <plan-presentation目录>/scripts/check_plan.py <规划路径>`（相对本技能为 `../plan-presentation/scripts/check_plan.py`）检查结构覆盖；宿主不能运行脚本时手工核对同样关系并说明。已有有效记录直接复用，不重做整条流程。

## 制作

制作只做一件事：把设计稿落实为 Page。应用模板用 template_apply（空白 Page，绑定本轮固定引用）；空白路径用 page_create，只传标题和少量（一到几个）`blocks:[{kind,data}]`，不手写整棵 document。按设计稿的幕顺序填入真实内容：导语、图形或组件、图注与要点；新增内容用 page_apply 的 `component.insert`，一次插入一到几个组件，例如 `operations:[{type:"component.insert",kind:"text",data:{format:"markdown",content:"..."},afterId:"上一块ID"}]`。`blocks` 与 `component.insert` 的 kind/data 相同：data 就是该组件的参数，文字统一用 `{kind:"text",data:{format:"markdown",content}}`；afterId 省略时追加到末尾，为 null 时放在最前；要放进容器内部（如 stepper 的某一步）时加 parentId，值为该容器的块 ID。page_create 返回含块 ID 的完整 document 与 hash/revision；page_apply 的 receipt 只含 hash/revision，按顺序追加时省略 afterId 即可，需要新块 ID 作锚点时用 response:"source"。每幕完成后记录实现它的 blockIds。

索引条目的 signature 一行给出组件参数的字段与类型，内置组件对应 data，自定义组件对应 data.props；用它判断适配、准备数据和核对顶层必填项，嵌套字段的必填与含义以 parameters 为准。选择组件后读其精确 guide，再按当前材料用 parameters 的 parameterPath 查字段含义、约束与例子；只在需要原始结构时读 schema。模板组件采用 template_context 返回的 componentId/version/integrity，不把局部名字当内置 kind。guide 返回 authoringReference 时沿用精确引用读取制作索引，流程见 [组件设计](../create-component/references/component-authoring.md)。现有数据调整或组合够用时复用；设计稿中确认的缺口进入 [create-component](../create-component/SKILL.md)。编辑 Board 的绘画、对象属性、布局或连接时读 [Board 对象编辑](references/board-authoring.md)。需要具体操作时才读 guide authoring/containers/document 等技术说明。

修改前 page_read({projectId,pageId,rendered:false,response:"source"}) 读取完整源与 hash/revision；局部编辑保留必要基线，不用局部 source 覆盖整页。优先 page_apply 的稳定节点操作，response:"receipt" 只收保存回执。本机连接中操作列表很长（例如带大量数据或 base64 资源）时，把 operations 数组写进 JSON 文件，用 `operationsFile:"/绝对路径/ops.json"` 代替内联；读取整页源或截图时可用 page_read 的 `out:"/绝对路径/文件"`，回执只含路径、sha256 与 hash/revision。页面上的自定义组件换新版本用 `component.ref.set`（见 [create-component](../create-component/SKILL.md)），不要删除后重新插入。修改已有组件数据用 `component.props.set`（blockId 加变化的顶层 props；每个列出的顶层键整体替换，不做深度合并，嵌套值要读出后改好整段回写）。组件数据带 `$binding` 时，参数来自项目的共享数据：`page_read` 的 bindings 给出解析后的参数，`component.props.set` 会把映射字段写回共享数据，规则见 [共享数据](../use-showai/references/shared-data.md)。改已有段落或标题的文字用 `block.text.set`（该段落/标题 ID 和纯文本）；Board 上矩形、椭圆或箭头的文字是绘画属性，用 `block.attrs.set` 改 `label`/`labelSize`，见 [Board 对象编辑](references/board-authoring.md)；需要新格式时删除旧文本块，再用 `component.insert` 插入 Markdown 文本块。单次参数保持浅而短，大改动拆成几次顺序 apply，每次沿用返回的 hash/revision。需要新模板绑定时以 page.set.fields.templateContext 保存 template_context 返回的 format/system/templates，去掉 hash。CONFLICT 必须比较基线、当前内容和尝试稿，保留无关修改；处理流程见 [use-showai](../use-showai/SKILL.md)。

## 评审与交付

制作完成后按 [review-presentation](../review-presentation/SKILL.md) 对照读者简报与设计稿检查：首屏、每幕的真实内容与交互、窄屏与静态、数字与来源；为最终规划填入 blockIds 并用 `check_plan.py <最终规划> --page <页面源 JSON>` 校验引用。源检查用 response:"source"；派生值与计算读默认 structured 视图与 response:"full"；图像检查可用 response:"receipt"。实际宿主交互遵循官方操控规则；没有执行的路径明确标注。

新建的作品保存后用 page_present，按 [宿主显示](../use-showai/references/host-display.md) 展示本轮真实 delivery。续改已有页面时在原页面上修改，保存后默认不调用 page_present（它的预览卡片看起来像一篇新文章），只告诉用户改了什么、页面在哪个项目并给出链接；用户要求查看效果时再展示。本机连接的 page_create、page_save 与 page_present 回执带 projectName 和 openUrl（showai://… 链接），page_apply 回执同样带项目与页面身份：交付时告诉用户页面存在哪个项目，并给出这个链接，用户点击即在 ShowAI 中打开。用户要求导出文件（离线 HTML、会话片段、网站）时用 page_export；只要页面源数据（JSON）供离线分析时用 page_read 的 out，共享数据用 dataset_read 的 out；页面中有组件读取内容库以外文件的共享数据时，page_export 先返回 `CONFIRMATION_REQUIRED` 和 `details.externalSnapshots`，按 [共享数据](../use-showai/references/shared-data.md#外部文件中的数据) 把各份数据的大小告诉用户，同意后再带 `externalData:"embed"` 导出；把 page_present 的 delivery 文件交给别人前同样处理其 `externalSnapshots`。页面要显示用户指明的本机数据文件（JSON、CSV、TSV）并与之同步时，先按同一节用 dataset_write 的 link 建立共享数据，再在页面中绑定。容量按需读 [容量](references/capacity.md)，局部展示与临时状态读 [页面阅读](references/page-reading.md)。只有用户要一份完整独立文件且不入库时用 render_document；连接、保存或显示失败不自动改变内容归属，也不改用 show_component 了事。

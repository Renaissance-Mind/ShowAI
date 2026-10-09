# ShowAI 技能与使用路径

ShowAI 插件提供一个统一指南和三个专门 Skill。统一指南建立内容模型、连接与对象归属，再按任务选择具体路径。独立软件提供 MCP 文档操作、阅读器、组件编译器及实际资源；宿主提供连接、项目上下文与结果呈现能力。CLI 用于启动、诊断和脚本。

| Skill | 何时读取 | 负责的结果 |
| --- | --- | --- |
| [use-showai](../plugins/showai/skills/use-showai/SKILL.md) | 首次使用、询问基础用法、查找或阅读已有内容、查看历史，或不清楚该选择哪个工作流程 | 理解内容库、项目、页面、组件与模板的关系；按条件取得入口、定位对象，完成阅读或路由到专门任务 |
| [show-document](../plugins/showai/skills/show-document/SKILL.md) | 创作、修改、展示或导出具体页面、报告、网站，或应用已有模板 | 保存可编辑页面，验收内容与交互，并按宿主能力交付整页或选区 |
| [create-component](../plugins/showai/skills/create-component/SKILL.md) | 用户要求可复用新组件，或数据调整与既有组件组合无法满足表达需求 | 保存精确版本的组件，在真实页面验证；整体任务包含页面时继续完成页面交付 |
| [create-template](../plugins/showai/skills/create-template/SKILL.md) | 新建、修改模板，或从页面提炼可复用结构 | 保存模板、填写提示和应用验证页面 |

## 发现与读取顺序

Agent 选择技能之前先看到名称与 description，因此主入口的 description 覆盖连接、阅读、查找与任务选择，专门 Skill 的 description 描述各自交付物。只有选择了 Skill 才会读取正文；新增参考文件不会自动使它进入 Agent 上下文。

首次使用或基础信息不明确时读 use-showai。用户直接选择专门 Skill 时，由该 Skill 链接到统一指南补齐信息。已经知道内容模型、拥有可信运行入口与对象身份时，可以直接继续专门任务。按当前操作读取参考和软件指南，避免每轮加载所有文档。

## 不同任务的下一步

| 场景 | 使用路径 |
| --- | --- |
| “ShowAI 怎么用” | use-showai 解释内容关系和任务路径；只有问题涉及本机状态时才调用软件 |
| “找一下项目里的报告并分析” | use-showai → 查询现有项目和页面 → reading；全文检索按需使用 history 指南 |
| “提取这一页的正文或数据” | use-showai → reading → 结构化或 Markdown；长页先 outline，再按节点读局部 |
| “看这一页有没有遮挡，按钮是否能用” | use-showai → reading → image 或 html/actions；需要将页面展示给用户时进入 show-document |
| “把材料做成报告”或“修改这份报告” | show-document → authoring、按需 containers/document → 保存、验收、展示 |
| “展示这一页/这几个区域”或“导出网站” | show-document → export 与对话展示参考；直接使用已有页面身份 |
| “有哪些合适的组件或模板” | use-showai → catalog 摘要 → 选中对象的 guide/schema/examples；决定应用后进入 show-document |
| “做一个新的可复用交互组件” | create-component → 查目录并评估组合 → component → 页面验证；需要页面交付时进入 show-document |
| “做一个周报模板”或“把这页提炼为模板” | create-template → templates → 按材料决定先做实例或直接建模板 → 应用验证；实例展示使用 show-document |
| “比较历史、合并草稿或恢复页面” | use-showai → history；写入前重新读完整页面与版本，需要内容修改时进入 show-document |
| “共享组件、合并资源版本或发布” | 对应专门 Skill → versions/publish；执行用户要求的范围 |
| “排查桌面编辑器或原生行为” | use-showai → 对应开发规则 → 实际工作台或桌面验收 |

具体命令、返回信息和路由条件见统一指南。三种页面读取方式见 [读取视图](../plugins/showai/skills/show-document/references/page-reading.md)。

## 运行入口与对象身份

Agent通过已连接的MCP操作ShowAI。首次调用showai_capabilities，并通过project_context或projects_list核对连接、内容库与项目身份。新正式内容在本机library连接中使用project_resolve解析可信宿主目录；远程使用授权项目。缺少连接时读取 [连接配置](../plugins/showai/skills/use-showai/references/runtime.md)，由宿主启动或重连，不能切换为创作CLI或未保存HTML。启动器会核对软件能力；插件更新不会升级软件。

项目不明确时走对象定位；这与入口是否已知是两个独立判断。读取任务使用现有项目和页面。创作未指定项目时，可按可信宿主目录执行 projects current，它首次可能创建目录项目。同目录的不同 session 共用项目，session 来源记录不能唯一定位页面。后续编辑保留 home、projectId、pageId 和节点身份，并重新读取当前 hash/revision。

## 复用、验证与交付

目录查询从有限摘要开始，选中对象再查 guide，准备输入时查 schema，需要例子时查 examples。开发组件或修改模板定义时才读取所需源码。组件负责表达与交互，模板负责结构与填写约定；应用已有模板由 show-document 完成。

模板可先用真实材料创作实例再提炼，也可按明确结构直接建立。两种方式都保存填写提示与可应用定义，再验证应用结果。通用结构反馈更新模板与预览，实例数据反馈更新页面；新组件实现按需进入 create-component。

内容核对使用结构化读取，布局检查使用图像，交互检查使用实际阅读器操作，编辑器与原生行为使用对应软件界面。编译成功、写入成功、导出成功与宿主展示完成分别证明各自环节。

页面创作、修改与展示的默认交付由 show-document 定义。保存完整页面后，通过page_present生成整页交付与可选节点预览，执行 [对话展示](../plugins/showai/skills/show-document/references/conversation-display.md) 中的宿主流程。只阅读时交付答案与来源；用户指定只保存、只要文件、面板或后台执行时采用其指定方式。插件更新后通过官方安装入口验证安装副本，并在新会话加载更新后的 Skills。

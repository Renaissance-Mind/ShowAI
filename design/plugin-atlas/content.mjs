export const skills = [
  {
    id: "use-showai",
    label: "连接与查找",
    icon: "compass",
    tagline: "建立上下文，找到正确入口。",
    summary:
      "解释内容模型，连接 CLI 或 MCP，定位项目与页面，读取内容、目录和历史，并把任务引向合适的 Skill。",
    when: [
      "首次使用或不清楚运行入口、内容归属",
      "查找项目、阅读页面、查询组件与模板",
      "查看历史、恢复内容、处理连接与同步",
    ],
    does: [
      "区分内容库、项目、页面节点、组件与模板。",
      "核对当前软件实际能力，取得真实项目与页面身份。",
      "按任务选择结构化内容、图像或交互阅读视图。",
    ],
    result: "已核实的入口与对象身份，或有来源的阅读、查询结果。",
    boundary:
      "只查询或阅读时即可结束；制作页面转入 show-document。已知可信上下文时，无需每次从头读取。",
    refs: ["runtime.md", "integration.md"],
    guides: ["workspace", "reading", "catalog", "history", "sync"],
    example: "找到我的项目里关于组件设计的页面，读一下目前有哪些规则。",
  },
  {
    id: "show-document",
    label: "页面与展示",
    icon: "document",
    tagline: "把材料组织成可读、可探索的页面。",
    summary:
      "创作、续改、展示与导出具体页面、报告和小型网站；组织内容、复用组件，也负责应用已有模板。",
    when: [
      "把材料做成页面、报告或小型网站",
      "修改已有页面，保留原页面身份",
      "展示整页或局部，导出 HTML 或应用模板",
    ],
    does: [
      "先确定读者要理解什么，再选择结构与交互。",
      "普通报告组织成一份 Page，按需嵌套 Board。",
      "核对当前版本后写入；验收视觉、主要交互与交付结果。",
    ],
    result: "具体页面及其保存回执，或独立 HTML、源文件与可用预览。",
    boundary:
      "新的可复用表达需要 create-component；建立模板本身由 create-template 负责。完成页面不会自动创建模板。",
    refs: ["conversation-display.md", "page-reading.md", "board-authoring.md"],
    guides: ["authoring", "containers", "document", "catalog", "export"],
    example: "把这份插件说明做成全宽交互文档，先给总览，再让读者逐层展开。",
  },
  {
    id: "create-component",
    label: "可复用组件",
    icon: "layers",
    tagline: "让一种表达方式可以反复使用。",
    summary:
      "当数据调整和已有组件组合仍不能表达需求时，创建或改造可复用 React 组件，定义输入、交互与读取行为。",
    when: [
      "用户明确需要新的可复用组件",
      "查找与组合后仍缺少表达或交互能力",
      "改造已有组件的实现、数据契约或读取模型",
    ],
    does: [
      "定义 manifest、schema、默认数据、示例与 React 入口。",
      "用 props 驱动表达，通过 onChange 返回正式编辑。",
      "复用宿主菜单，核对只读、导出、键盘、焦点和离线行为。",
    ],
    result: "可编译的组件源码包、精确版本及指纹，以及真实页面上的验证。",
    boundary:
      "组件需要使用时才调用此 Skill。阅读交互不保存正文；长期项目登记与本轮独立渲染是两条交付路径。",
    refs: ["component-authoring.md"],
    guides: ["component", "catalog", "versions"],
    example:
      "制作一个插件导览组件：切换 Skill 时同时更新职责、参考文档与任务路线。",
  },
  {
    id: "create-template",
    label: "可复用模板",
    icon: "grid",
    tagline: "保留结构，让下一份材料有章可循。",
    summary:
      "创建或修改可复用内容结构、组件组合和填写约定；可从成熟页面提炼，也可从明确的重复场景直接创建。",
    when: [
      "建立可反复使用的报告或页面模板",
      "把成熟页面提炼为通用结构",
      "调整模板的结构、填写规则与使用提示",
    ],
    does: [
      "分清固定结构、可替换事实、必填与可选材料。",
      "将实例事实替换成填写提示或有效空状态。",
      "保存模板，应用为预览，并用另一组材料检查复用。",
    ],
    result: "模板定义、填写说明、自然语言使用提示，以及应用验证页面。",
    boundary:
      "应用已有模板制作一份页面属于 show-document。填写提示由 Agent 解释执行，不等于自动变量绑定系统。",
    refs: ["template-abstraction.md", "template-creation.md"],
    guides: ["templates", "template-extraction", "versions"],
    example: "把这份项目周报提炼成模板，以后提供进展、风险和下一步就能复用。",
  },
];
export const fileNotes = {
  "plugin.json": [
    "插件身份与宿主入口",
    "声明插件名称、版本、品牌色、图标、展示文案，以及 onboardingSkill 指向 use-showai。",
    "元数据",
  ],
  ".claude-plugin/plugin.json": [
    "Claude 插件清单",
    "声明 Claude 侧插件身份与 skills 路径。当前版本字段为 0.7.2，与主清单的 0.9.0 不一致。",
    "元数据",
  ],
  "README.md": [
    "安装与整体说明",
    "解释四个 Skill 的分工、跨宿主接入、展示与同步、运行时和安装更新路径。",
    "说明",
  ],
  "assets/logo.svg": [
    "浅色界面品牌图标",
    "供宿主在插件列表、输入区或详情中显示 ShowAI 标识。",
    "资源",
  ],
  "assets/logo-dark.svg": [
    "深色界面品牌图标",
    "对应深色背景使用的图标资源，由插件清单引用。",
    "资源",
  ],
  "runtime.md": [
    "本地运行入口",
    "如何从连接配置取得可执行程序、参数与环境；核对 home、协议、实际能力及指南。",
    "参考",
  ],
  "integration.md": [
    "跨宿主接入",
    "区分展示与存储两个维度，说明 CLI/MCP 操作映射、公共资源、项目权限与源码交付。",
    "参考",
  ],
  "conversation-display.md": [
    "对话展示与导出",
    "根据宿主实际能力选择 MCP Apps、Codex inline、HTML 或项目回执；处理局部展示和体积上限。",
    "参考",
  ],
  "page-reading.md": [
    "三种读取视图",
    "结构化数据用于正文与源结构，图像用于视觉判断，HTML 用于操作；对应同一页面版本。",
    "参考",
  ],
  "board-authoring.md": [
    "Board 对象编辑",
    "解释外框、父子坐标、旋转、箭头绑定、跨容器移动及写入后的几何检查。",
    "参考",
  ],
  "component-authoring.md": [
    "组件设计与验证",
    "输入契约、源码包、依赖、派生读取模型、菜单入口、只读边界、可访问性与实际验证。",
    "参考",
  ],
  "template-abstraction.md": [
    "从页面提炼模板",
    "保留成熟页面，抽取叙事结构与组件关系，替换实例事实，再验证另一组材料。",
    "参考",
  ],
  "template-creation.md": [
    "直接创建模板",
    "从重复场景出发，设计使用提示、可填写结构、保存与应用流程，再根据反馈迭代。",
    "参考",
  ],
};
export const scenarios = [
  {
    id: "read",
    label: "查找与阅读",
    request: "“找到相关页面，解释目前的内容。”",
    route: ["use-showai"],
    steps: [
      ["定位", "查询现有项目与页面，取得真实 ID。"],
      ["读取", "长页先看提纲，再读取需要的正文或组件数据。"],
      ["回答", "提供有来源的阅读结果；需要展示时再进入展示流程。"],
    ],
    result: "阅读答案与来源，无需创建新页面。",
  },
  {
    id: "page",
    label: "制作页面",
    request: "“把这些材料做成一个交互文档。”",
    route: ["use-showai", "show-document"],
    steps: [
      ["取得上下文", "仅在入口或内容归属不明确时补齐。"],
      ["组织内容", "查询组件目录，以 Page 承载主要阅读顺序。"],
      ["验收与交付", "检查真实内容、视觉与交互，交付项目结果或 HTML。"],
    ],
    result: "一份可继续修改的页面，或独立展示及源文件。",
  },
  {
    id: "component",
    label: "开发组件",
    request: "“需要一个现有组件无法表达的联动交互。”",
    route: ["show-document", "create-component", "show-document"],
    steps: [
      ["检查复用", "先查目录，判断数据调整与组件组合是否足够。"],
      ["实现与验证", "定义输入与交互，编译新组件并放到实际页面验证。"],
      ["回到页面", "将新组件应用到用户页面，完成阅读与展示。"],
    ],
    result: "可复用组件，以及使用该组件的实际页面。",
  },
  {
    id: "template",
    label: "建立模板",
    request: "“把这类报告的结构保存下来，供以后复用。”",
    route: ["create-template", "show-document", "create-template"],
    steps: [
      ["选择路径", "已有材料时先做实例；结构明确时可直接建立模板。"],
      ["抽取结构", "保留阅读顺序与组合关系，替换实例事实。"],
      ["应用验证", "生成预览，检查填写规则；材料足够时用不同内容复测。"],
    ],
    result: "模板、使用提示与应用预览。中间的页面步骤按所选路径发生。",
  },
  {
    id: "export",
    label: "局部展示",
    request: "“只把这次更新的图表展示给我。”",
    route: ["use-showai", "show-document"],
    steps: [
      ["确认节点", "读取完整页面，取得组件或区域的稳定节点 ID。"],
      ["选择范围", "按 blockIds / --blocks 导出所选子树及必要祖先。"],
      ["交付", "根据宿主显示能力呈现，完整源页面保留。"],
    ],
    result: "局部预览或 HTML，不额外拆分源页面。",
  },
];
export const concepts = [
  [
    "内容库",
    "home",
    "实际读写的本机目录，包含项目与资源。代码仓库和插件目录都不等于内容库。",
  ],
  ["项目", "Project", "页面、组件与模板的归属单位；同步与权限按项目组织。"],
  [
    "页面",
    "Page / Board",
    "Page 负责顺序阅读，Board 负责空间布局；同一资源内可以原生嵌套。",
  ],
  [
    "组件",
    "Component",
    "由输入数据驱动的可复用表达或交互实现，页面引用具体版本。",
  ],
  [
    "模板",
    "Template",
    "可复用的内容结构、组件组合与填写说明，供 Agent 根据材料应用。",
  ],
  [
    "阅读结果",
    "JSON / image / HTML",
    "同一源页面的不同视图；读者预览里的临时操作不会自动保存正文。",
  ],
];
export const standards = [
  {
    title: "整体页面",
    owner: "show-document",
    status: "已有部分规则",
    current:
      "先明确读者需要理解什么；普通报告默认一份 Page；复用组件；视觉变化查看图像，交互变化实际操作。",
    gap: "统一的排版层级、间距、颜色语义和响应式页面规范尚未形成独立参考文档。",
    proposal: "可新增 page-design.md，并链接共用设计原则。",
  },
  {
    title: "组件制作",
    owner: "create-component",
    status: "已有专门文档",
    current:
      "component-authoring.md 已覆盖数据契约、依赖、菜单、焦点、只读与导出、可访问性及验收。",
    gap: "视觉规则以实际容器中可读为主，尚未形成统一的视觉参数体系。",
    proposal: "在现有组件规范里补齐内部布局和状态表达，复用共用原则。",
  },
  {
    title: "模板制作",
    owner: "create-template",
    status: "已有两条路径",
    current:
      "区分先做实例再提炼与直接创建；定义填写提示、必填与可选结构，并进行应用验证。",
    gap: "页面与组件的通用设计原则目前没有单一引用入口。",
    proposal: "引用共用设计原则与页面规范，保持模板规则聚焦复用。",
  },
  {
    title: "共用设计原则",
    owner: "建议归入 show-document/references",
    status: "待整理建议",
    current: "当前插件中没有独立的 design-principles.md 文件。",
    gap: "信息层级、文字可读性、颜色、间距与交互反馈需要统一维护。",
    proposal:
      "建立一份 design-principles.md，由页面、组件和模板 Skill 按需引用。",
  },
];

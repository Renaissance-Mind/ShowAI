export interface GlossaryRule {
  readonly rule: string;
  readonly locale: "zh-CN" | "en";
  readonly pattern: RegExp;
  readonly exemptKeys?: Readonly<Record<string, string>>;
}

const domainModules = {
  "layerDiagram.":
    "the layered diagram component shows the modules of an architecture",
};

export const glossaryRules: readonly GlossaryRule[] = [
  { rule: "复制 (⌘C) instead of 拷贝", locale: "zh-CN", pattern: /拷贝/ },
  { rule: "内容块 instead of 区块", locale: "zh-CN", pattern: /区块/ },
  {
    rule: "内容块 (page) or 对象 (board) instead of 模块",
    locale: "zh-CN",
    pattern: /模块/,
    exemptKeys: domainModules,
  },
  {
    rule: "内容块 instead of a bare 块",
    locale: "zh-CN",
    pattern: /个块|此块|该块|这个块/,
  },
  {
    rule: "Agent instead of AI as the feature name",
    locale: "zh-CN",
    pattern: /(?<![A-Za-z])AI(?![A-Za-z])/,
  },
  {
    rule: "页面 / 白板 instead of Page / Board in Chinese text",
    locale: "zh-CN",
    pattern: /(?<![A-Za-z])(?:Page|Board|Pages|Boards)(?![A-Za-z])/,
  },
  {
    rule: "创建副本 for duplicating; 复制 means the clipboard",
    locale: "zh-CN",
    pattern:
      /复制(?:对象|内容块|选中对象|所选对象|页面(?!引用|链接)|\s*\{count\}\s*个对象)/,
  },
  { rule: "移动画布 instead of 抓手", locale: "zh-CN", pattern: /抓手/ },
  {
    rule: "block (page) or object (board) instead of module",
    locale: "en",
    pattern: /\bmodules?\b/i,
    exemptKeys: domainModules,
  },
  {
    rule: "Agent instead of AI as the feature name",
    locale: "en",
    pattern: /(?<![A-Za-z])AI(?![A-Za-z])/,
  },
  {
    rule: "Agent, capitalised, as the product term",
    locale: "en",
    pattern: /\bagents?\b(?![-\w]|\.\w)/,
    exemptKeys: {
      "onboarding.welcome.title":
        "the product tagline speaks of humans and agents in general",
    },
  },
  {
    rule: "Pan canvas instead of Hand",
    locale: "en",
    pattern: /\bhand tool\b|^Hand\b/i,
  },
  {
    rule: "page / board in lower case inside sentences",
    locale: "en",
    pattern: /[\w}][ ,]+(?:a |an |the |this |each )?(?:Page|Board)s?\b/,
    exemptKeys: {
      "desktop.menu.": "macOS menu items use title case",
      "desktop.close.export": "a dialog button in title case, like the menus",
    },
  },
  { rule: "board instead of whiteboard", locale: "en", pattern: /whiteboard/i },
];

export const englishInChinese: readonly string[] = [
  "Token URL",
  "Tailscale Funnel",
  "Logs or screenshots",
  "Responses API",
  "Chat Completions",
  "Claude Code",
  "Codex SDK",
  "DeepSeek Harness",
  "Diagram Design",
  "Apple Pencil",
  "Wi-Fi",
  "ShowAI App",
  "ShowAI Cloud",
  "API Key",
  "LLM API",
];

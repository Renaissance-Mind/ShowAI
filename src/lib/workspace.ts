import type { JSONContent } from "@tiptap/core";
import type { ShowDocument, Workspace } from "../types";

export const STORAGE_KEY = "showai.workspace.v1";
export const HISTORY_KEY = "showai.history.v1";
export const text = (
  value: string,
  marks?: JSONContent["marks"],
): JSONContent => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
export const paragraph = (value = ""): JSONContent => ({
  type: "paragraph",
  content: value ? [text(value)] : [],
});
export const heading = (value: string, level = 2): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
export const widget = (
  kind: string,
  data: Record<string, unknown>,
): JSONContent => ({ type: "widget", attrs: { kind, data } });

export function newDocument(
  title = "无标题",
  parentId: string | null = null,
): ShowDocument {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    icon: "📄",
    cover: "none",
    parentId,
    favorite: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    content: { type: "doc", content: [paragraph()] },
    comments: [],
  };
}

export function initialWorkspace(): Workspace {
  const welcome = newDocument("一份可以探索的文档");
  welcome.icon = "✳";
  welcome.cover = "sage";
  welcome.favorite = true;
  welcome.content = {
    type: "doc",
    content: [
      paragraph(
        "让文字、数据与灵感，住在同一个地方。这里是 ShowAI，一个为思考而留白、为探索而生的轻量文档空间。",
      ),
      {
        type: "callout",
        attrs: { tone: "sage", icon: "✦" },
        content: [
          paragraph(
            "从这里开始：点击任何文字直接编辑，输入 / 添加区块。所有修改都会自动保存在当前浏览器。",
          ),
        ],
      },
      heading("想法不止一种形状"),
      paragraph(
        "像写文档一样自然，也像使用网页一样自由。把研究发现组织成清晰的段落，让复杂信息变得可以触摸、比较与探索。",
      ),
      widget("metrics", {
        title: "",
        items: [
          {
            label: "自由书写",
            value: "Aa",
            detail: "Markdown · 富文本 · 区块",
          },
          { label: "深入探索", value: "↗", detail: "图表 · 数据库 · 交互控件" },
          { label: "随身携带", value: "∞", detail: "本地保存 · 单文件 HTML" },
        ],
      }),
      heading("让数据自己说话"),
      paragraph(
        "试着切换曲线或悬停查看数值，也可以打开区块设置修改数据。下面使用 y = x 与 y = x² 展示图表交互。",
      ),
      widget("chart", {
        title: "两种增长的形状",
        description: "数学函数示例 · x 从 0 到 5",
        type: "line",
        labels: ["0", "1", "2", "3", "4", "5"],
        series: [
          { name: "y = x²", values: [0, 1, 4, 9, 16, 25], color: "#547c63" },
          { name: "y = x", values: [0, 1, 2, 3, 4, 5], color: "#c6925c" },
        ],
      }),
      heading("把下一步，写在这里"),
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [paragraph("打开你的第一份交互文档")],
          },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [paragraph("输入 /，插入一个新的区块")],
          },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [paragraph("导出为 HTML，在任何浏览器里打开")],
          },
        ],
      },
      { type: "horizontalRule" },
      paragraph(
        "这是你的空间。可以保留这些提示，也可以选中它们，开始写下自己的故事。",
      ),
    ],
  };
  const research = newDocument("研究工作台");
  research.icon = "🔎";
  research.content = {
    type: "doc",
    content: [
      heading("给每个结论，一个出处"),
      paragraph(
        "在这里收集问题、证据和自己的判断。数据库可以切换表格与看板视图，所有字段都可以继续编辑。",
      ),
      widget("database", {
        title: "研究资料",
        columns: [
          { id: "name", name: "资料标题", type: "text" },
          {
            id: "status",
            name: "状态",
            type: "select",
            options: ["待阅读", "阅读中", "已整理"],
          },
          { id: "url", name: "来源", type: "url" },
          { id: "checked", name: "已核实", type: "checkbox" },
        ],
        rows: [
          {
            id: "source-1",
            name: "ShowAI 使用说明",
            status: "已整理",
            url: "",
            checked: true,
          },
        ],
        groupBy: "status",
      }),
      heading("核心问题"),
      paragraph("你希望这次调研回答什么？"),
      heading("证据与观察"),
      paragraph(),
      heading("结论与下一步"),
      paragraph(),
    ],
  };
  const playground = newDocument("交互实验室");
  playground.icon = "🧪";
  playground.content = {
    type: "doc",
    content: [
      heading("让读者参与思考"),
      paragraph(
        "滑动下面的参数，观察结果如何变化。公式使用两个参数的乘积，适合时长、数量等简单估算。数据仅用于演示计算。",
      ),
      widget("playground", {
        title: "阅读时间估算",
        description: "每日阅读分钟数 × 阅读天数",
        inputs: [
          {
            id: "minutes",
            label: "每天阅读",
            min: 5,
            max: 120,
            step: 5,
            value: 30,
            unit: "分钟",
          },
          {
            id: "days",
            label: "阅读天数",
            min: 1,
            max: 30,
            step: 1,
            value: 7,
            unit: "天",
          },
        ],
        operation: "product",
        resultLabel: "累计阅读时间",
        unit: "分钟",
      }),
      heading("区块可以持续生长"),
      paragraph(
        "ShowAI 将每种交互内容注册为独立区块。新增组件只需提供名称、默认数据和 React 渲染器，即可接入编辑器与离线导出。",
      ),
      {
        type: "codeBlock",
        attrs: { language: "typescript" },
        content: [
          text(
            "registerBlock({\n  kind: 'my-block',\n  label: '我的区块',\n  description: '自定义交互内容',\n  createData: () => ({}),\n  Component: MyBlock,\n})",
          ),
        ],
      },
    ],
  };
  return {
    version: 1,
    documents: [welcome, research, playground],
    activeId: welcome.id,
    theme: "light",
    font: "sans",
    wide: false,
  };
}

export function plainText(content: JSONContent): string {
  if (content.text) return content.text;
  if (content.type === "widget")
    return String(content.attrs?.data?.title ?? "");
  return (content.content ?? [])
    .map(plainText)
    .join(content.type === "doc" ? "\n" : "");
}

export function outlines(content: JSONContent) {
  let position = 0;
  return (content.content ?? []).flatMap((node) => {
    const current = position;
    // ProseMirror nodeSize includes a boundary at either side of non-leaf nodes.
    const size = (n: JSONContent): number =>
      n.type === "text"
        ? (n.text?.length ?? 0)
        : n.content
          ? 2 + n.content.reduce((sum, child) => sum + size(child), 0)
          : 1;
    position += size(node);
    return node.type === "heading"
      ? [
          {
            title: plainText(node),
            level: node.attrs?.level ?? 2,
            position: current,
          },
        ]
      : [];
  });
}

export function toMarkdown(node: JSONContent, depth = 0): string {
  const children = () =>
    (node.content ?? []).map((child) => toMarkdown(child, depth)).join("");
  if (node.type === "text") {
    let value = node.text ?? "";
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") value = `**${value}**`;
      if (mark.type === "italic") value = `*${value}*`;
      if (mark.type === "strike") value = `~~${value}~~`;
      if (mark.type === "code") value = "`" + value + "`";
      if (mark.type === "link") value = `[${value}](${mark.attrs?.href ?? ""})`;
    }
    return value;
  }
  switch (node.type) {
    case "doc":
      return children().trim() + "\n";
    case "heading":
      return "#".repeat(node.attrs?.level ?? 2) + " " + children() + "\n\n";
    case "paragraph":
      return children() + "\n\n";
    case "hardBreak":
      return "  \n";
    case "horizontalRule":
      return "\n---\n\n";
    case "codeBlock":
      return (
        "```" +
        (node.attrs?.language ?? "") +
        "\n" +
        plainText(node) +
        "\n```\n\n"
      );
    case "blockquote":
    case "callout":
      return (
        children()
          .trim()
          .split("\n")
          .map((line) => "> " + line)
          .join("\n") + "\n\n"
      );
    case "bulletList":
    case "orderedList":
    case "taskList":
      return (
        (node.content ?? [])
          .map(
            (child, i) =>
              "  ".repeat(depth) +
              (node.type === "orderedList"
                ? `${i + 1}. `
                : node.type === "taskList"
                  ? `- [${child.attrs?.checked ? "x" : " "}] `
                  : "- ") +
              (child.content ?? [])
                .map((n) => toMarkdown(n, depth + 1))
                .join("")
                .trim() +
              "\n",
          )
          .join("") + "\n"
      );
    case "image":
      return `![${node.attrs?.alt ?? ""}](${node.attrs?.src ?? ""})\n\n`;
    case "widget":
      return (
        "```showai-block\n" + JSON.stringify(node.attrs, null, 2) + "\n```\n\n"
      );
    case "table":
      return (
        (node.content ?? [])
          .map(
            (row, index) =>
              "| " +
              (row.content ?? [])
                .map((cell) => plainText(cell).replaceAll("|", "\\|"))
                .join(" | ") +
              " |\n" +
              (index === 0
                ? "| " +
                  (row.content ?? []).map(() => "---").join(" | ") +
                  " |\n"
                : ""),
          )
          .join("") + "\n"
      );
    default:
      return children();
  }
}

export function canReparent(
  documents: ShowDocument[],
  id: string,
  parentId: string | null,
) {
  let parent = parentId;
  const seen = new Set<string>();
  while (parent) {
    if (parent === id || seen.has(parent)) return false;
    seen.add(parent);
    parent = documents.find((d) => d.id === parent)?.parentId ?? null;
  }
  return true;
}

export function downloadFile(name: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name.replace(/[<>:"/\\|?*]/g, "_");
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

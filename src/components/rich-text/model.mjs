import { mathMarkdown } from "../blocks/markdown-math.mjs";

export const richTextFormats = [
  "bold",
  "italic",
  "underline",
  "strike",
  "highlight",
  "code",
  "link",
  "textStyle",
];
export const richTextAlignments = ["left", "center", "right", "justify"];
// Editors label these by value from their own message catalog.
export const richTextFonts = [
  { value: "" },
  { value: "sans-serif" },
  { value: "serif" },
  { value: "monospace" },
];
const decodeText = (value) =>
  value.replace(
    /&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi,
    (entity) => {
      const named = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
        "&nbsp;": "\u00a0",
      };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const hex = /^&#x/i.test(entity);
      const n = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff
        ? String.fromCodePoint(n)
        : entity;
    },
  );
const textNode = (text, marks = []) =>
  text ? [{ type: "text", text, ...(marks.length ? { marks } : {}) }] : [];
/** Markdown is an import format. Editing and AI patches share the structured document. */
export function markdownToRichText(
  source,
  { allowComponentBlocks = false } = {},
) {
  function inline(tokens, marks = []) {
    return (tokens ?? []).flatMap((t) => {
      const mark = {
        strong: "bold",
        em: "italic",
        del: "strike",
        codespan: "code",
      }[t.type];
      if (mark)
        return t.type === "codespan"
          ? textNode(t.text, [...marks, { type: mark }])
          : inline(t.tokens, [...marks, { type: mark }]);
      if (t.type === "link")
        return inline(t.tokens, [
          ...marks,
          {
            type: "link",
            attrs: { href: t.href, ...(t.title ? { title: t.title } : {}) },
          },
        ]);
      if (t.type === "br") return [{ type: "hardBreak" }];
      if (t.type === "mathInline" || t.type === "mathBlock")
        return [
          {
            type: "mathInline",
            attrs: { latex: t.text, display: !!t.display },
          },
        ];
      if (t.type === "image")
        return [
          {
            type: "image",
            attrs: { src: t.href, alt: t.text, title: t.title ?? null },
          },
        ];
      if (t.tokens) return inline(t.tokens, marks);
      return textNode(
        t.type === "text" ? decodeText(t.text ?? "") : (t.text ?? t.raw ?? ""),
        marks,
      );
    });
  }
  function paragraph(content) {
    const result = [];
    let run = [];
    const flush = () => {
      if (run.length) {
        result.push({ type: "paragraph", content: run });
        run = [];
      }
    };
    for (const node of content) {
      if (node.type === "image") {
        flush();
        result.push(node);
      } else run.push(node);
    }
    flush();
    return result.length ? result : [{ type: "paragraph", content: [] }];
  }
  function blocks(tokens) {
    return tokens.flatMap((t) => {
      switch (t.type) {
        case "space":
        case "checkbox":
        case "def":
          return [];
        case "heading":
          return [
            {
              type: "heading",
              attrs: { level: t.depth },
              content: inline(t.tokens),
            },
          ];
        case "paragraph":
        case "text":
          return paragraph(
            t.tokens ? inline(t.tokens) : textNode(t.text ?? ""),
          );
        case "blockquote":
          return [{ type: "blockquote", content: blocks(t.tokens) }];
        case "code":
          if (allowComponentBlocks && t.lang?.trim() === "showai-block") {
            const attrs = JSON.parse(t.text);
            if (
              typeof attrs.kind !== "string" ||
              !attrs.data ||
              typeof attrs.data !== "object" ||
              Array.isArray(attrs.data)
            )
              throw Error("showai-block 区块格式不正确");
            return [{ type: "widget", attrs }];
          }
          return [
            {
              type: "codeBlock",
              attrs: { language: t.lang ?? null },
              content: textNode(t.text),
            },
          ];
        case "hr":
          return [{ type: "horizontalRule" }];
        case "mathBlock":
          return [{ type: "mathBlock", attrs: { latex: t.text } }];
        case "list": {
          const task = t.items.some((i) => i.task);
          return [
            {
              type: task
                ? "taskList"
                : t.ordered
                  ? "orderedList"
                  : "bulletList",
              ...(t.ordered ? { attrs: { start: Number(t.start) || 1 } } : {}),
              content: t.items.map((i) => ({
                type: task ? "taskItem" : "listItem",
                ...(task ? { attrs: { checked: !!i.checked } } : {}),
                content: blocks(i.tokens),
              })),
            },
          ];
        }
        case "table":
          return [
            {
              type: "table",
              content: [t.header, ...t.rows].map((row, index) => ({
                type: "tableRow",
                content: row.map((cell, col) => ({
                  type: index ? "tableCell" : "tableHeader",
                  attrs: {
                    colspan: 1,
                    rowspan: 1,
                    colwidth: null,
                    ...(t.align[col] ? { textAlign: t.align[col] } : {}),
                  },
                  content: [
                    { type: "paragraph", content: inline(cell.tokens) },
                  ],
                })),
              })),
            },
          ];
        default:
          return [{ type: "paragraph", content: inline([t]) }];
      }
    });
  }
  return { type: "doc", content: blocks(mathMarkdown.lexer(source)) };
}
export function richTextDocument(data) {
  if (typeof data.content === "string")
    return data.format === "plain"
      ? {
          type: "doc",
          content: data.content
            .split("\n")
            .map((text) => ({ type: "paragraph", content: textNode(text) })),
        }
      : markdownToRichText(data.content);
  return normalizeContentTree(
    data.content ?? { type: "doc", content: [{ type: "paragraph" }] },
  );
}
const nodes = new Set([
  "doc",
  "text",
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "hardBreak",
  "horizontalRule",
  "image",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "callout",
  "toggle",
  "widget",
  "region",
  "richText",
  "pageModule",
  "mathInline",
  "mathBlock",
]);
export function validateRichTextData(data) {
  if (typeof data.content === "string") {
    if (
      data.content.length > 1000000 ||
      !["markdown", "plain", undefined].includes(data.format)
    )
      throw Error("富文本的旧文本输入格式无效。");
    return;
  }
  if (data.format !== undefined && data.format !== "richtext")
    throw Error("结构化富文本使用 format: richtext。");
  if (
    !data.content ||
    data.content.type !== "doc" ||
    !Array.isArray(data.content.content)
  )
    throw Error("富文本 content 必须是 doc 内容树。");
  let count = 0;
  const visit = (node, depth = 0) => {
    if (++count > 12000 || depth > 48 || !node || !nodes.has(node.type))
      throw Error("富文本包含无效的节点或超出大小限制。");
    if (node.type === "text" && typeof node.text !== "string")
      throw Error("文字节点需要 text。");
    if (
      node.attrs?.textAlign &&
      !richTextAlignments.includes(node.attrs.textAlign)
    )
      throw Error("无效的段落对齐。");
    if (
      ["mathInline", "mathBlock"].includes(node.type) &&
      typeof node.attrs?.latex !== "string"
    )
      throw Error("公式需要 latex 源码。");
    for (const mark of node.marks ?? []) {
      if (!richTextFormats.includes(mark.type))
        throw Error("无效的富文本格式。");
      if (
        mark.attrs?.mode != null &&
        (mark.type !== "highlight" ||
          !["lower", "full"].includes(mark.attrs.mode))
      )
        throw Error("高亮模式必须是 lower 或 full。");
      for (const key of [
        "color",
        "fontFamily",
        "fontSize",
        "backgroundColor",
      ]) {
        if (mark.attrs?.[key] != null && typeof mark.attrs[key] !== "string")
          throw Error(`文字格式 ${key} 必须是字符串。`);
      }
      if (
        ["color", "backgroundColor", "fontFamily"].some(
          (key) =>
            typeof mark.attrs?.[key] === "string" &&
            /[;{}<>]/.test(mark.attrs[key]),
        )
      )
        throw Error("文字样式必须是单个 CSS 属性值。");
      if (
        mark.type === "textStyle" &&
        mark.attrs?.fontSize &&
        !/^\d+(?:\.\d+)?(?:px|em|rem|%)$/.test(mark.attrs.fontSize)
      )
        throw Error("文字字号需要 CSS 长度，例如 20px。");
      if (
        mark.type === "link" &&
        !/^(https?:\/\/|mailto:|tel:|#)/i.test(mark.attrs?.href ?? "")
      )
        throw Error("无效的文字链接。");
    }
    if (
      node.type === "image" &&
      node.attrs?.src !== "" &&
      !/^(https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|avif);base64,)/i.test(
        node.attrs?.src ?? "",
      )
    )
      throw Error("无效的图片地址。");
    if (node.content !== undefined) {
      if (!Array.isArray(node.content))
        throw Error("富文本节点 content 必须为数组。");
      node.content.forEach((child) => visit(child, depth + 1));
    }
  };
  visit(data.content);
}

export function createRichTextNode(data, id = crypto.randomUUID()) {
  validateRichTextData(data);
  const { content, format, ...appearance } = data;
  return {
    type: "richText",
    attrs: {
      id,
      name: "富文本",
      ...(Object.keys(appearance).length ? { data: appearance } : {}),
    },
    content: richTextDocument(data).content,
  };
}
export function richTextStyle(data = {}) {
  data ??= {};
  return {
    color: data.color || undefined,
    backgroundColor: data.backgroundColor || undefined,
    fontSize: typeof data.fontSize === "number" ? data.fontSize : undefined,
    textAlign: data.align || undefined,
    borderRadius: typeof data.radius === "number" ? data.radius : undefined,
    padding: typeof data.padding === "number" ? data.padding : undefined,
  };
}

/** Canonical content nodes shared by document editing, the catalog and SDK. */
export const primitiveNodeTypes = Object.freeze({
  __proto__: null,
  image: "image",
  code: "codeBlock",
  table: "table",
  callout: "callout",
  toggle: "toggle",
  divider: "horizontalRule",
});
export function primitiveContentNode(kind, data, id) {
  const type = primitiveNodeTypes[kind];
  if (!type) throw new Error(`Not a basic content component: ${kind}`);
  const style = Object.fromEntries(
    ["color", "backgroundColor", "fontSize", "align", "padding", "radius"]
      .filter((key) => data[key] !== undefined)
      .map((key) => [key, data[key]]),
  );
  const attrs = {
    ...(id ? { id } : {}),
    ...(Object.keys(style).length ? { componentStyle: style } : {}),
  };
  const node = { type, attrs };
  if (kind === "image") {
    attrs.width = data.width ?? "100%";
    for (const key of [
      "src",
      "alt",
      "caption",
      "title",
      "width",
      "height",
      "fit",
      "nativeInk",
    ])
      if (data[key] !== undefined) attrs[key] = structuredClone(data[key]);
  } else if (kind === "code") {
    attrs.language = data.language ?? null;
    node.content = textNode(data.content ?? "");
  } else if (kind === "table") {
    attrs.title = data.title ?? "";
    node.content = [data.columns, ...data.rows].map((row, index) => ({
      type: "tableRow",
      content: row.map((value, column) => ({
        type: index ? "tableCell" : "tableHeader",
        attrs: {
          colspan: 1,
          rowspan: 1,
          colwidth:
            typeof data.fontSize === "number" && data.fontSize >= 18
              ? [data.fontSize * 10 + 16]
              : null,
          textAlign: data.columnAlignments?.[column] ?? data.align ?? "left",
          scalarValue: value,
        },
        content: [{ type: "paragraph", content: textNode(String(value)) }],
      })),
    }));
  } else if (kind === "callout" || kind === "toggle") {
    attrs.title =
      kind === "toggle"
        ? (data.summary ?? data.title ?? "")
        : (data.title ?? "");
    if (kind === "toggle") attrs.open = data.open === true;
    else {
      attrs.icon = data.icon ?? "💡";
      attrs.tone = data.tone ?? "sage";
    }
    node.content = richTextDocument({ content: data.content }).content;
    if (!node.content.length) node.content = [{ type: "paragraph" }];
  }
  return node;
}
/** Pure, idempotent compatibility conversion. Original files and history are untouched. */
export function normalizeContentTree(input) {
  const visit = (inputNode) => {
    let node = inputNode;
    if (node.type === "widget" && primitiveNodeTypes[node.attrs?.kind]) {
      const { kind, data, ...identity } = node.attrs;
      node = data.document
        ? {
            type: "richText",
            attrs: { kind },
            content: normalizeContentTree(data.document).content,
          }
        : primitiveContentNode(kind, data, identity.id);
      node.attrs = { ...identity, ...node.attrs };
    }
    if (Array.isArray(node.content)) node.content = node.content.map(visit);
    if (
      ["tableCell", "tableHeader"].includes(node.type) &&
      node.attrs?.scalarValue != null
    ) {
      const plain = (value) =>
        value.type === "text"
          ? value.text
          : (value.content ?? []).map(plain).join("");
      if (plain(node) !== String(node.attrs.scalarValue))
        node.attrs.scalarValue = plain(node);
    }
    return node;
  };
  return visit(structuredClone(input));
}

/** Keep existing component.props.set callers working against the canonical content node. */
export function patchPrimitiveContentNode(node, props) {
  if (node.type === "richText" && primitiveNodeTypes[node.attrs?.kind]) {
    if (props.document)
      return { ...node, content: normalizeContentTree(props.document).content };
    const next = structuredClone(node);
    const index = next.content.findIndex(
      (child) => child.type === primitiveNodeTypes[node.attrs.kind],
    );
    if (index < 0) throw new Error("The component content has been removed.");
    next.content[index] = patchPrimitiveContentNode(next.content[index], props);
    return next;
  }
  const kind = Object.keys(primitiveNodeTypes).find(
    (key) => primitiveNodeTypes[key] === node.type,
  );
  if (!kind) throw new Error("Expected a basic content node.");
  if (props.document)
    return {
      type: "richText",
      attrs: { id: node.attrs?.id, kind },
      content: normalizeContentTree(props.document).content,
    };
  const next = structuredClone(node);
  next.attrs ??= {};
  const styleKeys = [
    "color",
    "backgroundColor",
    "fontSize",
    "align",
    "padding",
    "radius",
  ];
  for (const key of styleKeys)
    if (props[key] !== undefined)
      next.attrs.componentStyle = {
        ...next.attrs.componentStyle,
        [key]: props[key],
      };
  const plain = (value) =>
    value.type === "text"
      ? value.text
      : (value.content ?? []).map(plain).join("");
  if (kind === "table") {
    if (props.title !== undefined) next.attrs.title = props.title;
    if (props.columns !== undefined || props.rows !== undefined) {
      const columns = props.columns ?? next.content[0].content.map(plain);
      const rows =
        props.rows ??
        next.content
          .slice(1)
          .map((row) =>
            row.content.map((cell) => cell.attrs?.scalarValue ?? plain(cell)),
          );
      const converted = primitiveContentNode("table", { columns, rows });
      next.content = converted.content.map((row, r) => ({
        ...row,
        attrs: next.content[r]?.attrs,
        content: row.content.map((cell, c) => {
          const previous = next.content[r]?.content[c];
          return previous && plain(previous) === plain(cell)
            ? previous
            : { ...cell, attrs: { ...previous?.attrs, ...cell.attrs } };
        }),
      }));
    }
    if (props.align !== undefined || props.columnAlignments !== undefined)
      next.content.forEach((row) =>
        row.content.forEach((cell, column) => {
          cell.attrs = {
            ...cell.attrs,
            textAlign:
              props.columnAlignments?.[column] ??
              props.align ??
              next.attrs.componentStyle?.align ??
              "left",
          };
        }),
      );
  } else {
    for (const [key, value] of Object.entries(props)) {
      if (styleKeys.includes(key)) continue;
      if (key === "content")
        next.content =
          kind === "code"
            ? textNode(value)
            : richTextDocument({ content: value }).content;
      else next.attrs[key === "summary" ? "title" : key] = value;
    }
  }
  return normalizeContentTree(next);
}

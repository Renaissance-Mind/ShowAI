// Shared by the browser importer and the dependency-free artifact command.
export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
export const ARTIFACT_DATA_ID = "showai-data";
const MAX_NODES = 12000;
const MAX_DEPTH = 48;
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const nodeTypes = new Set([
  "doc",
  "paragraph",
  "text",
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
  "tableCell",
  "tableHeader",
  "callout",
  "toggle",
  "widget",
]);
const markTypes = new Set([
  "bold",
  "italic",
  "strike",
  "code",
  "underline",
  "link",
  "highlight",
]);
const nodeAttributes = new Set([
  "id",
  "level",
  "textAlign",
  "align",
  "type",
  "start",
  "checked",
  "language",
  "src",
  "alt",
  "title",
  "width",
  "height",
  "colspan",
  "rowspan",
  "colwidth",
  "backgroundColor",
  "open",
  "summary",
  "icon",
  "tone",
  "kind",
  "data",
]);
const markAttributes = new Set([
  "href",
  "title",
  "target",
  "rel",
  "class",
  "color",
  "backgroundColor",
  "fontFamily",
  "fontSize",
]);

function object(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object.`);
  return value;
}

function string(value, path, limit = 1000000) {
  if (typeof value !== "string" || value.length > limit)
    throw new Error(`${path} must be text, at most ${limit} characters.`);
  return value;
}

export function isSafeUrl(value, image = false) {
  if (typeof value !== "string") return false;
  if (
    image &&
    /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(value)
  )
    return true;
  if (!image && value.startsWith("#")) return true;
  if (/^[\u0000-\u0020]|[\u0000-\u001f]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (
      image ? ["http:", "https:"] : ["http:", "https:", "mailto:", "tel:"]
    ).includes(parsed.protocol);
  } catch {
    return false;
  }
}

function validateJson(value, path, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error(`${path} is nested too deeply.`);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error(`${path} must be a finite number.`);
    return;
  }
  if (typeof value === "string") {
    string(value, path, MAX_ARTIFACT_BYTES);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_NODES)
      throw new Error(`${path} contains too many items.`);
    value.forEach((item, i) => validateJson(item, `${path}[${i}]`, depth + 1));
    return;
  }
  object(value, path);
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new Error(`${path} must contain plain JSON objects.`);
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenKeys.has(key))
      throw new Error(`${path} contains a reserved key.`);
    validateJson(item, `${path}.${key}`, depth + 1);
  }
}

function validateAttrs(attrs, path, permitted) {
  object(attrs, path);
  for (const [key, value] of Object.entries(attrs)) {
    if (!permitted.has(key))
      throw new Error(`Unsupported attribute ${path}.${key}.`);
    if (value === null || value === undefined) continue;
    if (key === "href" && !isSafeUrl(value))
      throw new Error(`${path}.href must be a safe web, email, or anchor URL.`);
    if (key === "src" && !isSafeUrl(value, true))
      throw new Error(
        `${path}.src must be a web URL or embedded raster image.`,
      );
    if (
      ["textAlign", "align"].includes(key) &&
      !["left", "center", "right", "justify"].includes(value)
    )
      throw new Error(`${path}.${key} is not supported.`);
    if (key === "level" && ![1, 2, 3].includes(value))
      throw new Error(`${path}.level must be 1 through 3.`);
    if (key === "type" && !["1", "a", "A", "i", "I"].includes(value))
      throw new Error(`${path}.type must be an ordered-list marker style.`);
    if (["open", "checked"].includes(key) && typeof value !== "boolean")
      throw new Error(`${path}.${key} must be true or false.`);
    if (
      ["colspan", "rowspan", "start"].includes(key) &&
      (!Number.isInteger(value) || value < 1 || value > 10000)
    )
      throw new Error(`${path}.${key} must be a positive integer.`);
    if (
      [
        "id",
        "language",
        "alt",
        "title",
        "summary",
        "icon",
        "tone",
        "kind",
        "target",
        "rel",
        "class",
      ].includes(key)
    )
      string(value, `${path}.${key}`, 10000);
    if (
      ["width", "height"].includes(key) &&
      !(
        typeof value === "number" &&
        Number.isFinite(value) &&
        value > 0 &&
        value <= 10000
      ) &&
      !(typeof value === "string" && /^\d{1,5}(?:px|%)?$/.test(value))
    )
      throw new Error(`${path}.${key} must be a positive image dimension.`);
    if (
      key === "colwidth" &&
      (!Array.isArray(value) ||
        value.length > 100 ||
        !value.every(
          (width) => Number.isInteger(width) && width >= 0 && width <= 10000,
        ))
    )
      throw new Error(
        `${path}.colwidth must contain non-negative column widths.`,
      );
    if (
      ["color", "backgroundColor"].includes(key) &&
      (typeof value !== "string" ||
        !/^(?:#[a-f\d]{3,8}|[a-z]{1,24}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i.test(
          value,
        ))
    )
      throw new Error(`${path}.${key} must be a CSS color.`);
  }
}

function validateWidgetData(kind, data, path) {
  if (
    ![
      "chart",
      "database",
      "metrics",
      "playground",
      "gallery",
      "bookmark",
    ].includes(kind)
  )
    return;
  const list = (key, limit) => {
    if (data[key] === undefined) return [];
    if (!Array.isArray(data[key]) || data[key].length > limit)
      throw new Error(
        `${path}.${key} must be an array of at most ${limit} items.`,
      );
    return data[key];
  };
  const label = (value, name) => {
    if (value !== undefined) string(value, `${path}.${name}`, 10000);
  };
  const rows = (items, requireId = false) => {
    const ids = new Set();
    for (const [i, item] of items.entries()) {
      object(item, `${path}[${i}]`);
      if (requireId) {
        string(item.id, `${path}[${i}].id`, 200);
        if (!item.id || ids.has(item.id) || forbiddenKeys.has(item.id))
          throw new Error(`${path} requires unique, non-reserved IDs.`);
        ids.add(item.id);
      }
    }
    return items;
  };
  label(data.title, "title");
  label(data.description, "description");
  if (kind === "chart") {
    const labels = list("labels", 500),
      series = rows(list("series", 20));
    for (const value of labels) string(value, `${path}.labels`, 1000);
    if (data.type !== undefined && !["line", "bar"].includes(data.type))
      throw new Error(`${path}.type must be line or bar.`);
    for (const item of series) {
      string(item.name, `${path}.series.name`, 1000);
      if (
        !Array.isArray(item.values) ||
        item.values.length !== labels.length ||
        !item.values.every(
          (value) => typeof value === "number" && Number.isFinite(value),
        )
      )
        throw new Error(
          `${path}.series values must be finite numbers matching labels.`,
        );
      if (
        item.color !== undefined &&
        (typeof item.color !== "string" ||
          !/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(
            item.color,
          ))
      )
        throw new Error(`${path}.series color must be a hex color.`);
    }
    label(data.unit, "unit");
  }
  if (kind === "database") {
    const columns = rows(list("columns", 50), true);
    for (const column of columns) {
      if (column.id === "id")
        throw new Error(
          `${path}.column id cannot use the reserved row identity key id.`,
        );
      string(column.name, `${path}.column.name`, 1000);
      if (
        !["text", "number", "select", "checkbox", "url"].includes(column.type)
      )
        throw new Error(`${path} contains an unsupported column type.`);
      if (
        column.options !== undefined &&
        (!Array.isArray(column.options) ||
          column.options.length > 200 ||
          !column.options.every((value) => typeof value === "string"))
      )
        throw new Error(`${path}.options must be an array of text.`);
    }
    for (const row of rows(list("rows", 5000), true))
      for (const value of Object.values(row))
        if (!["string", "number", "boolean"].includes(typeof value))
          throw new Error(`${path}.rows must have scalar cells.`);
    label(data.groupBy, "groupBy");
  }
  if (kind === "metrics")
    for (const item of rows(list("items", 100))) {
      string(item.label, `${path}.item.label`, 1000);
      if (!["string", "number"].includes(typeof item.value))
        throw new Error(`${path}.item.value must be text or a number.`);
      label(item.unit, "item.unit");
      label(item.detail, "item.detail");
      if (
        item.trend !== undefined &&
        (typeof item.trend !== "number" || !Number.isFinite(item.trend))
      )
        throw new Error(`${path}.item.trend must be a finite number.`);
    }
  if (kind === "playground") {
    if (
      data.operation !== undefined &&
      !["sum", "product", "average"].includes(data.operation)
    )
      throw new Error(`${path}.operation is unsupported.`);
    for (const input of rows(list("inputs", 30), true)) {
      string(input.label, `${path}.input.label`, 1000);
      if (
        ![input.min, input.max, input.step, input.value].every(
          (value) => typeof value === "number" && Number.isFinite(value),
        ) ||
        input.min >= input.max ||
        input.step <= 0 ||
        input.value < input.min ||
        input.value > input.max
      )
        throw new Error(
          `${path}.input requires a valid range, positive step, and initial value within the range.`,
        );
      label(input.unit, "input.unit");
    }
    label(data.resultLabel, "resultLabel");
    label(data.unit, "unit");
  }
  if (kind === "gallery") {
    if (data.columns !== undefined && ![1, 2, 3].includes(data.columns))
      throw new Error(`${path}.columns must be 1, 2, or 3.`);
    for (const item of rows(list("images", 100), true)) {
      if (item.src !== "" && !isSafeUrl(item.src, true))
        throw new Error(`${path}.image.src must be a safe raster image URL.`);
      label(item.alt, "image.alt");
      label(item.caption, "image.caption");
    }
  }
  if (kind === "bookmark") {
    if (data.url !== undefined && data.url !== "" && !isSafeUrl(data.url))
      throw new Error(`${path}.url must be a safe URL.`);
    if (
      data.image !== undefined &&
      data.image !== "" &&
      !isSafeUrl(data.image, true)
    )
      throw new Error(`${path}.image must be a safe raster image URL.`);
  }
}

function validateNode(value, path, counter, depth = 0) {
  if (++counter.count > MAX_NODES)
    throw new Error(`Document exceeds ${MAX_NODES} nodes.`);
  if (depth > MAX_DEPTH) throw new Error("Document is nested too deeply.");
  const node = object(value, path);
  if (!nodeTypes.has(node.type))
    throw new Error(`Unsupported block type at ${path}: ${String(node.type)}.`);
  for (const key of Object.keys(node))
    if (!["type", "attrs", "content", "marks", "text"].includes(key))
      throw new Error(`Unsupported node field ${path}.${key}.`);
  if (node.type === "text") {
    string(node.text, `${path}.text`);
    if (!node.text.length) throw new Error(`${path}.text cannot be empty.`);
  } else if (node.text !== undefined)
    throw new Error(`Only text nodes can have a text field: ${path}.`);
  if (node.attrs !== undefined)
    validateAttrs(node.attrs, `${path}.attrs`, nodeAttributes);
  if (node.type === "image" && !isSafeUrl(node.attrs?.src, true))
    throw new Error(`${path} requires a safe image src.`);
  if (node.type === "widget") {
    string(node.attrs?.kind, `${path}.attrs.kind`, 80);
    if (!/^[a-z][a-z0-9-]*$/.test(node.attrs.kind))
      throw new Error(
        "Widget kind must use lowercase letters, numbers, and hyphens.",
      );
    object(node.attrs?.data, `${path}.attrs.data`);
    validateWidgetData(node.attrs.kind, node.attrs.data, `${path}.attrs.data`);
  }
  if (node.marks !== undefined) {
    if (!["text", "hardBreak"].includes(node.type))
      throw new Error(`${path} cannot have inline marks.`);
    if (!Array.isArray(node.marks))
      throw new Error(`${path}.marks must be an array.`);
    for (const [i, mark] of node.marks.entries()) {
      object(mark, `${path}.marks[${i}]`);
      for (const key of Object.keys(mark))
        if (!["type", "attrs"].includes(key))
          throw new Error(`Unsupported mark field: ${key}.`);
      if (!markTypes.has(mark.type))
        throw new Error(`Unsupported text mark: ${String(mark.type)}.`);
      if (mark.attrs !== undefined)
        validateAttrs(mark.attrs, `${path}.marks[${i}].attrs`, markAttributes);
      if (mark.type === "link" && !isSafeUrl(mark.attrs?.href))
        throw new Error("Links require a safe href.");
    }
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content))
      throw new Error(`${path}.content must be an array.`);
    if (
      ["text", "image", "widget", "hardBreak", "horizontalRule"].includes(
        node.type,
      )
    )
      throw new Error(`${path} cannot contain child blocks.`);
    node.content.forEach((child, i) =>
      validateNode(child, `${path}.content[${i}]`, counter, depth + 1),
    );
  }
  const children = node.content ?? [];
  const blockTypes = [
    "paragraph",
    "heading",
    "blockquote",
    "bulletList",
    "orderedList",
    "taskList",
    "codeBlock",
    "horizontalRule",
    "image",
    "table",
    "callout",
    "toggle",
    "widget",
  ];
  const allowed = {
    doc: blockTypes,
    paragraph: ["text", "hardBreak"],
    heading: ["text", "hardBreak"],
    codeBlock: ["text"],
    blockquote: blockTypes,
    callout: blockTypes,
    toggle: blockTypes,
    bulletList: ["listItem"],
    orderedList: ["listItem"],
    listItem: blockTypes,
    taskList: ["taskItem"],
    taskItem: blockTypes,
    table: ["tableRow"],
    tableRow: ["tableCell", "tableHeader"],
    tableCell: blockTypes,
    tableHeader: blockTypes,
  }[node.type];
  if (allowed && children.some((child) => !allowed.includes(child.type)))
    throw new Error(`${path} contains an invalid child block.`);
  if (
    [
      "blockquote",
      "callout",
      "toggle",
      "bulletList",
      "orderedList",
      "listItem",
      "taskList",
      "taskItem",
      "table",
      "tableRow",
      "tableCell",
      "tableHeader",
    ].includes(node.type) &&
    !children.length
  )
    throw new Error(`${path} must contain at least one child block.`);
  if (
    ["listItem", "taskItem"].includes(node.type) &&
    children[0]?.type !== "paragraph"
  )
    throw new Error(`${path} must start with a paragraph.`);
  if (
    node.type === "codeBlock" &&
    children.some((child) => child.marks?.length)
  )
    throw new Error(`${path} cannot contain formatted code.`);
}

export function validateDocument(value) {
  validateJson(value, "document");
  if (
    new TextEncoder().encode(JSON.stringify(value)).length > MAX_ARTIFACT_BYTES
  )
    throw new Error("Document exceeds the 10 MB limit.");
  const document = object(value, "document");
  string(document.id, "document.id", 200);
  string(document.title, "document.title", 1000);
  if (!document.id) throw new Error("Document id is required.");
  if (document.content?.type !== "doc")
    throw new Error("Document content must be a doc node.");
  validateNode(document.content, "document.content", { count: 0 });
  const now = new Date().toISOString();
  for (const key of ["createdAt", "updatedAt"])
    if (
      document[key] !== undefined &&
      (typeof document[key] !== "string" ||
        !Number.isFinite(Date.parse(document[key])))
    )
      throw new Error(`document.${key} must be an ISO date string.`);
  if (document.parentId != null)
    string(document.parentId, "document.parentId", 200);
  for (const key of ["favorite", "archived"])
    if (document[key] !== undefined && typeof document[key] !== "boolean")
      throw new Error(`document.${key} must be true or false.`);
  if (document.comments !== undefined && !Array.isArray(document.comments))
    throw new Error("document.comments must be an array.");
  const comments = (document.comments ?? []).map((comment, i) => {
    object(comment, `comments[${i}]`);
    string(comment.id, "comment.id", 200);
    string(comment.text, "comment.text", 10000);
    if (
      typeof comment.createdAt !== "string" ||
      !Number.isFinite(Date.parse(comment.createdAt))
    )
      throw new Error("comment.createdAt must be an ISO date string.");
    if (typeof comment.resolved !== "boolean")
      throw new Error("comment.resolved must be true or false.");
    return {
      id: comment.id,
      text: comment.text,
      createdAt: comment.createdAt,
      resolved: comment.resolved,
    };
  });
  return {
    id: document.id,
    title: document.title,
    icon:
      document.icon === undefined
        ? "✦"
        : string(document.icon, "document.icon", 64),
    cover:
      document.cover === undefined
        ? "none"
        : string(document.cover, "document.cover", 2000),
    parentId: document.parentId ?? null,
    favorite: document.favorite ?? false,
    archived: document.archived ?? false,
    createdAt: document.createdAt ?? now,
    updatedAt: document.updatedAt ?? now,
    content: structuredClone(document.content),
    comments,
  };
}

function validateComponents(input) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > 100) throw new Error('components must be an array of at most 100 packages.');
  validateJson(input, 'components');
  const seen = new Set();
  return input.map((item, i) => {
    object(item, `components[${i}]`);
    string(item.id, 'component.id', 80);
    string(item.name, 'component.name', 200);
    string(item.version, 'component.version', 80);
    string(item.html, 'component.html', MAX_ARTIFACT_BYTES);
    string(item.integrity, 'component.integrity', 200);
    if (!/^[a-z][a-z0-9-]*$/.test(item.id) || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(item.version)) throw new Error('Invalid component identity.');
    const key = `${item.id}@${item.version}`;
    if (seen.has(key)) throw new Error(`Duplicate embedded component: ${key}`);
    seen.add(key);
    if (typeof item.schema !== 'boolean') object(item.schema, 'component.schema');
    if (item.inline !== undefined) {
      object(item.inline, 'component.inline');
      string(item.inline.script, 'component.inline.script', MAX_ARTIFACT_BYTES);
      string(item.inline.styles, 'component.inline.styles', MAX_ARTIFACT_BYTES);
    }
    return structuredClone(item);
  });
}

export function parseArtifact(input) {
  if (
    typeof input === "string" &&
    new TextEncoder().encode(input).length > MAX_ARTIFACT_BYTES
  )
    throw new Error("Artifact exceeds the 10 MB limit.");
  const artifact = object(
    typeof input === "string" ? JSON.parse(input) : input,
    "artifact",
  );
  if (artifact.format !== "showai" || artifact.version !== 1)
    throw new Error(
      'Expected a ShowAI artifact with format "showai" and version 1.',
    );
  return {
    format: "showai",
    version: 1,
    document: validateDocument(artifact.document),
    ...(artifact.components === undefined ? {} : { components: validateComponents(artifact.components) }),
  };
}

export function serializeArtifact(document, components) {
  const result = JSON.stringify(
    { format: "showai", version: 1, document: validateDocument(document), ...(components?.length ? { components: validateComponents(components) } : {}) },
    null,
    2,
  );
  if (new TextEncoder().encode(result).length > MAX_ARTIFACT_BYTES)
    throw new Error("Serialized artifact exceeds the 10 MB limit.");
  return result;
}

export function escapeJsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function injectArtifactIntoHtml(template, document, components) {
  const artifact = {
    format: "showai",
    version: 1,
    document: validateDocument(document),
    ...(components?.length ? { components: validateComponents(components) } : {}),
  };
  const serialized = escapeJsonForHtml(artifact);
  if (new TextEncoder().encode(serialized).length > MAX_ARTIFACT_BYTES)
    throw new Error("Embedded artifact exceeds the 10 MB limit.");
  const dataTag =
    /<script\b(?=[^>]*\bid=["']showai-data["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>[\s\S]*?<\/script>/i;
  if (!dataTag.test(template))
    throw new Error(
      "Viewer template is missing its ShowAI data placeholder. Run npm run build:portable first.",
    );
  const title = document.title.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
  return template
    .replace(
      dataTag,
      () =>
        `<script id="${ARTIFACT_DATA_ID}" type="application/json">${serialized}</script>`,
    )
    .replace(
      /<title>[\s\S]*?<\/title>/i,
      () => `<title>${title} · ShowAI</title>`,
    );
}

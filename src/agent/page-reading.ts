import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { FileStore } from "../core/store";
import { CoreError } from "../core/model";
import { versionedLibrary, logicalPath } from "../core/library-runtime";
import { readArchivedReader } from "../core/archived-reader";
import { resolveDocumentComponents } from "../core/catalog";
import { selectDocumentBlocks } from "../portable/selection.mjs";
import { assertExportDestination, buildPageHtml } from "./exporter";
import { renderReading, type ReadingCapture } from "./reading-renderer";
import type { ShowDocument } from "../types";
import type { JSONContent } from "@tiptap/core";
import { collectCustomComponentRefs } from "../components/custom/contract";

export const READ_VIEWS = ["structured", "image", "html"] as const;
const roles = [
  "button",
  "checkbox",
  "combobox",
  "textbox",
  "slider",
  "link",
  "tab",
  "menuitem",
] as const;
export const readingActionSchema = z
  .object({
    type: z.enum([
      "click",
      "hover",
      "fill",
      "select",
      "check",
      "uncheck",
      "drag",
    ]),
    blockId: z.string().min(1).max(200).optional(),
    selector: z.string().min(1).max(500).optional(),
    role: z.enum(roles).optional(),
    name: z.string().min(1).max(500).optional(),
    value: z.string().max(4000).optional(),
    dx: z.number().min(-2560).max(2560).optional(),
    dy: z.number().min(-2160).max(2160).optional(),
  })
  .strict()
  .superRefine((action, ctx) => {
    if (!!action.selector === !!action.role)
      ctx.addIssue({
        code: "custom",
        message: "An action needs exactly one selector or role/name target.",
      });
    if (action.role && !action.name)
      ctx.addIssue({
        code: "custom",
        message: "Role targets require an accessible name.",
      });
    if (["fill", "select"].includes(action.type) && action.value === undefined)
      ctx.addIssue({
        code: "custom",
        message: "Fill/select actions require value.",
      });
    if (
      action.type === "drag" &&
      action.dx === undefined &&
      action.dy === undefined
    )
      ctx.addIssue({
        code: "custom",
        message: "Drag requires dx or dy in viewport pixels.",
      });
  });
export const pageReadSchema = z
  .object({
    view: z.enum(READ_VIEWS).default("structured"),
    format: z.enum(["json", "markdown"]).default("json"),
    detail: z.enum(["full", "outline"]).default("full"),
    blockIds: z.array(z.string().min(1).max(200)).min(1).max(100).optional(),
    theme: z.enum(["light", "dark"]).default("light"),
    viewport: z
      .object({
        width: z.number().int().min(320).max(2560),
        height: z.number().int().min(240).max(2160),
      })
      .strict()
      .default({ width: 1000, height: 900 }),
    presentation: z.enum(["reading", "spatial"]).default("reading"),
    actions: z.array(readingActionSchema).max(20).default([]),
    draft: z.boolean().default(false),
    rendered: z.boolean().optional(),
    expectedHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    out: z.string().min(1).optional(),
    overwrite: z.boolean().default(false),
  })
  .strict();
export type PageReadOptions = z.input<typeof pageReadSchema>;
export type ReadingOptions = z.output<typeof pageReadSchema>;
export type ReadingAction = z.output<typeof readingActionSchema>;
export interface ReadIdentity {
  revision?: string;
  projectId: string;
  pageId: string;
  title: string;
  hash: string;
  partial: boolean;
  blockIds?: string[];
  view: (typeof READ_VIEWS)[number];
  componentRefs: { id: string; version: string; integrity?: string }[];
}
export interface StructuredRead extends ReadIdentity {
  view: "structured";
  format: "json";
  document: ShowDocument;
  path: string;
  markdown: string;
  outline: OutlineItem[];
  computed: ReadingCapture["components"];
}
interface OutlineItem {
  id?: string;
  type: string;
  title: string;
  depth: number;
  kind?: string;
}
export type PageReadResult =
  | StructuredRead
  | (ReadIdentity & {
      format?: "markdown" | "outline";
      markdown?: string;
      outline?: OutlineItem[];
      computed?: ReadingCapture["components"];
      path?: string;
      url?: string;
      state?: Omit<ReadingOptions, "out" | "overwrite">;
      capturedAt?: string;
      dom?: ReadingCapture["dom"];
      image?: { width: number; height: number; mimeType: "image/png" };
      metadataPath?: string;
    });

function text(node: JSONContent): string {
  return node.text ?? (node.content ?? []).map(text).join("");
}
function markdownText(node: JSONContent): string {
  if (node.type !== "text")
    return (node.content ?? []).map(markdownText).join("");
  let value = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "link") value = `[${value}](${mark.attrs?.href ?? ""})`;
    else if (mark.type === "bold") value = `**${value}**`;
    else if (mark.type === "italic") value = `*${value}*`;
    else if (mark.type === "strike") value = `~~${value}~~`;
    else if (mark.type === "code")
      value = `\`${value.replaceAll("`", "\\`")}\``;
  }
  return value;
}
export function structuredContent(document: ShowDocument) {
  const outline: OutlineItem[] = [];
  const lines = [`# ${document.title}`, ""];
  function visit(node: JSONContent, depth: number) {
    const attrs = node.attrs ?? {};
    if (node.type === "text") return;
    const kind = node.type === "widget" ? String(attrs.kind ?? "") : undefined;
    const title =
      node.type === "surface" || node.type === "region"
        ? String(attrs.name ?? attrs.title ?? "")
        : node.type === "widget"
          ? String(attrs.data?.props?.title ?? attrs.data?.title ?? kind)
          : text(node);
    if (attrs.id)
      outline.push({
        id: attrs.id,
        type: node.type ?? "unknown",
        title: title.slice(0, 200),
        depth,
        ...(kind ? { kind } : {}),
      });
    if (node.type === "widget") {
      if (attrs.kind === "text") {
        lines.push(String(attrs.data?.content ?? ""), "");
        return;
      }
      lines.push(
        `### ${title || "组件"} [${attrs.id ?? ""}]`,
        "",
        "```json",
        JSON.stringify(
          attrs.kind === "custom"
            ? {
                componentId: attrs.data?.componentId,
                version: attrs.data?.version,
                props: attrs.data?.props,
              }
            : attrs.data,
          null,
          2,
        ),
        "```",
        "",
      );
      return;
    }
    if (node.type === "heading") {
      lines.push(
        `${"#".repeat(Math.min(6, Math.max(1, Number(attrs.level ?? 2))))} ${markdownText(node)}`,
        "",
      );
      return;
    }
    if (["paragraph", "codeBlock"].includes(node.type ?? "")) {
      lines.push(
        node.type === "codeBlock"
          ? `\`\`\`${attrs.language ?? ""}\n${text(node)}\n\`\`\``
          : markdownText(node),
        "",
      );
      return;
    }
    if (node.type === "image") {
      lines.push(
        `![${attrs.alt ?? "图片"}](${String(attrs.src ?? "").startsWith("data:") ? "embedded-image" : (attrs.src ?? "")})`,
        "",
      );
      return;
    }
    if (node.type === "table") {
      const rows = (node.content ?? []).map((row) =>
        (row.content ?? []).map((cell) =>
          markdownText(cell).replaceAll("|", "\\|").replaceAll("\n", " "),
        ),
      );
      if (rows.length) {
        lines.push(
          `| ${rows[0].join(" | ")} |`,
          `| ${rows[0].map(() => "---").join(" | ")} |`,
          ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
          "",
        );
      }
      return;
    }
    if ((node.type === "surface" || node.type === "region") && title)
      lines.push(`${"#".repeat(Math.min(6, depth + 2))} ${title}`, "");
    if (node.type === "toggle")
      lines.push(`### ${attrs.title ?? "折叠内容"}`, "");
    if (node.type === "listItem" || node.type === "taskItem") {
      lines.push(
        `${node.type === "taskItem" ? `- [${attrs.checked ? "x" : " "}]` : "-"} ${markdownText(node)}`,
        "",
      );
      return;
    }
    for (const child of node.content ?? []) visit(child, depth + 1);
  }
  visit(document.content, 0);
  return { outline, markdown: lines.join("\n").trim() };
}

function previewHtml(
  html: string,
  state: ReadingOptions,
  identity: ReadIdentity,
): string {
  const payload = JSON.stringify({
    draft: state.draft,
    theme: state.theme,
    identity,
    state,
  }).replaceAll("<", "\\u003c");
  return html.replace(
    "</head>",
    `<script type="application/json" id="showai-read-options">${payload}</script></head>`,
  );
}
async function outputPath(
  store: FileStore,
  projectId: string,
  path: string,
  overwrite: boolean,
) {
  const absolute = resolve(path);
  await assertExportDestination(store.root, projectId, absolute);
  const exists = await readFile(absolute).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  if (exists && !overwrite)
    throw new CoreError(
      "INVALID_DATA",
      `Reading output already exists: ${absolute}. Choose another path or pass --overwrite.`,
    );
  await mkdir(dirname(absolute), { recursive: true });
  return absolute;
}

export async function readPageView(
  store: FileStore,
  projectId: string,
  pageId: string,
  input: PageReadOptions = {},
): Promise<PageReadResult> {
  const options = pageReadSchema.parse(input);
  if (
    options.view !== "structured" &&
    (options.detail !== "full" ||
      options.format !== "json" ||
      options.rendered !== undefined)
  )
    throw new CoreError(
      "INVALID_DATA",
      "format/detail/rendered apply to structured reading only.",
    );
  const record = await store.readPage(projectId, pageId);
  if (options.expectedHash && options.expectedHash !== record.hash)
    throw new CoreError(
      "CONFLICT",
      "The page changed since the preceding read. Read the current structured view before continuing.",
      { currentHash: record.hash },
    );
  const document = options.blockIds
    ? selectDocumentBlocks(record.document, options.blockIds)
    : record.document;
  const sourceOnly =
    options.view === "structured" &&
    (options.detail === "outline" || options.rendered === false);
  if (sourceOnly && options.actions.length)
    throw new CoreError(
      "INVALID_DATA",
      "Source-only reading cannot execute actions.",
    );
  const components = sourceOnly
    ? []
    : await resolveDocumentComponents(store.root, document, projectId);
  const identity: ReadIdentity = {
    projectId,
    pageId,
    title: record.document.title,
    hash: record.hash,
    ...(record.revision ? { revision: record.revision } : {}),
    view: options.view,
    partial: !!options.blockIds,
    ...(options.blockIds ? { blockIds: options.blockIds } : {}),
    componentRefs: sourceOnly
      ? collectCustomComponentRefs(document).map((ref) => ({
          id: ref.componentId,
          version: ref.version,
          ...(ref.integrity ? { integrity: ref.integrity } : {}),
        }))
      : components.map((component) => ({
          id: component.id,
          version: component.version,
          integrity: component.integrity,
        })),
  };
  const { out: _out, overwrite: _overwrite, ...state } = options;
  const content = structuredContent(document);
  if (options.view === "structured" && options.detail === "outline") {
    const outlineMarkdown = `# ${identity.title}\n\n${content.outline.map((node) => `${"  ".repeat(node.depth)}- ${node.title || node.type} [${node.id}]`).join("\n")}`;
    const result =
      options.format === "markdown"
        ? {
            ...identity,
            format: "markdown" as const,
            markdown: outlineMarkdown,
            outline: content.outline,
          }
        : { ...identity, format: "outline" as const, outline: content.outline };
    if (options.out) {
      const target = await outputPath(
        store,
        projectId,
        options.out,
        options.overwrite,
      );
      await writeFile(
        target,
        options.format === "markdown"
          ? outlineMarkdown
          : JSON.stringify(result, null, 2),
      );
    }
    return result;
  }
  const render =
    options.view !== "structured" ||
    options.rendered === true ||
    options.actions.length > 0 ||
    (options.rendered !== false &&
      components.some((component) => component.reader === "readData"));
  let capture: ReadingCapture | undefined;
  let path: string | undefined;
  const generated = join(
    store.root,
    "projects",
    projectId,
    "exports",
    "reads",
    `${pageId}-${record.hash.slice(0, 12)}-${randomUUID()}`,
  );
  if (render) {
    const library = versionedLibrary(store.root),
      revision = record.revision ?? (library ? await library.head() : null);
    const reader =
      library && revision
        ? await readArchivedReader(
            logicalPath(store.root, record.path)!,
            (path) => library.readFile(path, revision),
          )
        : null;
    const html = previewHtml(
      await buildPageHtml(
        document,
        undefined,
        components,
        [],
        options.presentation,
        options.blockIds ? { blockIds: options.blockIds } : undefined,
        reader?.html,
      ),
      options,
      identity,
    );
    path = await outputPath(
      store,
      projectId,
      options.view === "html" && options.out
        ? options.out
        : `${generated}.html`,
      options.overwrite,
    );
    await writeFile(path, html, "utf8");
    capture = await renderReading(path, options);
  }
  const computed = capture?.components ?? [];
  const markdown =
    content.markdown +
    (computed.some((component) => component.status === "computed")
      ? `\n\n## 组件计算结果（派生字段）\n\n\`\`\`json\n${JSON.stringify(
          computed.filter((component) => component.status === "computed"),
          null,
          2,
        )}\n\`\`\``
      : "");
  if (options.view === "structured") {
    if (options.out) {
      const target = await outputPath(
        store,
        projectId,
        options.out,
        options.overwrite,
      );
      await writeFile(
        target,
        options.format === "markdown"
          ? markdown
          : JSON.stringify(
              { ...identity, document, outline: content.outline, computed },
              null,
              2,
            ),
      );
    }
    return options.format === "markdown"
      ? {
          ...identity,
          format: "markdown",
          markdown,
          outline: content.outline,
          computed,
        }
      : {
          ...identity,
          view: "structured",
          format: "json",
          document,
          path: record.path,
          markdown,
          outline: content.outline,
          computed,
        };
  }
  if (!capture || !path)
    throw new Error("A rendered reading did not produce a capture.");
  if (options.view === "image") {
    path = await outputPath(
      store,
      projectId,
      options.out ?? `${generated}.png`,
      options.overwrite,
    );
    await writeFile(path, capture.png);
  }
  const result = {
    ...identity,
    path,
    url: pathToFileURL(path).href,
    state,
    capturedAt: capture.capturedAt,
    dom: capture.dom,
    computed,
    ...(options.view === "image"
      ? {
          image: {
            width: capture.width,
            height: capture.height,
            mimeType: "image/png" as const,
          },
        }
      : {}),
  };
  const metadataPath = await outputPath(
    store,
    projectId,
    `${path}.read.json`,
    options.overwrite,
  );
  await writeFile(metadataPath, JSON.stringify(result, null, 2));
  return { ...result, metadataPath };
}

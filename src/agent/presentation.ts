import { CapacityError } from "../portable/capacity.mjs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AgentService } from "./service";
import { catalogPage, type CatalogView } from "./disclosure";
import { FileStore } from "../core/store";
import { buildPageHtml } from "./exporter";
import {
  saveComponent,
  resolveDocumentComponents,
  lockDocumentComponents,
  listBuiltinComponents,
} from "../core/catalog";
import { toInlineFragment } from "../portable/inline.mjs";
import {
  serializeArtifact,
  validateDocument,
} from "../portable/validation.mjs";
import { upgradeResource } from "../surface/containers.mjs";
import { selectDocumentBlocks } from "../portable/selection.mjs";
import type { ComponentSource } from "../components/custom/types";
import { assertProps } from "../components/custom/schema";
import type { ShowDocument } from "../types";

const object = z.record(z.string(), z.unknown());
export const presentationSchema = {
  document: object
    .optional()
    .describe(
      "Complete ShowAI document. Custom nodes must be {type:'widget',attrs:{id,kind:'custom',data:{componentId,version,props}}}; do not use the component ID as kind. Read component schemas before authoring.",
    ),
  templateId: z
    .string()
    .optional()
    .describe(
      "Public template ID; get its editable source and customize it, or instantiate it directly.",
    ),
  title: z.string().max(300).optional(),
  componentSources: z
    .array(object)
    .max(20)
    .optional()
    .describe(
      "Editable component packages with manifest, schema, source, files and assets; compiled in an isolated temporary workspace.",
    ),
  blockIds: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe(
      "Optional node IDs to show inline. Complete HTML and source retain the full document.",
    ),
};
export type PresentationInput = z.infer<z.ZodObject<typeof presentationSchema>>;

const text = (id: string, content: string) => ({
  type: "widget",
  attrs: { id, kind: "text", data: { content, format: "markdown" } },
});
const publicTemplates = [
  {
    id: "explainer",
    name: "交互讲解",
    description: "从一个问题出发，用例子、图解和来源解释内容。",
    sections: [
      ["question", "## 问题\n写下读者要理解的问题。"],
      ["example", "## 从例子开始\n填入任务提供的例子。"],
      ["visual", "## 看清关系\n在这里插入合适的图解组件。"],
      ["sources", "## 依据\n补充可核实的来源。"],
    ],
  },
  {
    id: "comparison",
    name: "方案对比",
    description: "按同一组维度比较候选方案，并记录选择依据。",
    sections: [
      ["goal", "## 选择目标\n说明需要解决的任务。"],
      ["dimensions", "## 比较维度\n列出影响选择的条件。"],
      ["options", "## 候选方案\n用任务提供的材料填写各方案。"],
      ["decision", "## 判断与依据\n记录取舍及待核实事项。"],
    ],
  },
  {
    id: "research-note",
    name: "研究笔记",
    description: "保留问题、局部证据、解释及后续验证，便于人和 Agent 续改。",
    sections: [
      ["question", "## 研究问题\n写下本次关注的问题。"],
      ["evidence", "## 证据\n记录来源、观察及适用范围。"],
      ["interpretation", "## 理解\n连接证据与解释。"],
      ["next", "## 下一步\n记录尚待验证的问题。"],
    ],
  },
];

export function publicTemplate(id: string): ShowDocument {
  const found = publicTemplates.find((item) => item.id === id);
  if (!found)
    throw new Error(`Unknown public template: ${id}. Use public_catalog_list.`);
  return upgradeResource(
    validateDocument({
      id: randomUUID(),
      title: found.name,
      content: {
        type: "doc",
        content: found.sections.map(([key, content]) => text(key, content)),
      },
    }),
  );
}
export async function publicCatalog(
  input: {
    kind?: "component" | "template";
    query?: string;
    limit?: number;
    cursor?: string;
  } = {},
) {
  const components =
    input.kind === "template"
      ? []
      : (
          await new AgentService({
            root: join(tmpdir(), "showai-public-catalog"),
          }).catalogList({
            kind: "component",
            scope: "builtin",
            query: input.query,
          })
        ).items;
  const query = input.query?.toLocaleLowerCase();
  const templates =
    input.kind === "component"
      ? []
      : publicTemplates
          .filter(
            (item) =>
              !query ||
              `${item.id} ${item.name} ${item.description}`
                .toLocaleLowerCase()
                .includes(query),
          )
          .map(({ id, name, description }) => ({
            kind: "template",
            id,
            name,
            description,
            scenarios: [description],
            scope: "public",
            version: "1.0.0",
          }));
  const items = [...components, ...templates];
  return {
    ...catalogPage(items, {
      limit: input.limit,
      cursor: input.cursor,
      key: { kind: input.kind, query: input.query },
    }),
    requiresLogin: false,
    synchronizationRequired: false,
  };
}
export async function describePublicResource(
  id: string,
  input: {
    kind?: "component" | "template";
    view?: CatalogView;
    file?: string;
  } = {},
) {
  if (
    input.kind === "template" ||
    (input.kind !== "component" &&
      publicTemplates.some((item) => item.id === id))
  ) {
    const template = publicTemplates.find((item) => item.id === id);
    if (!template) throw new Error(`Unknown public template: ${id}`);
    return {
      kind: "template",
      id,
      name: template.name,
      description: template.description,
      version: "1.0.0",
      scope: "public",
      editable: true,
      guide:
        "Customize the returned document. Render it without a private project, or save it using page_create in an authorized project.",
      ...(input.view === "source" || input.view === "examples"
        ? { document: publicTemplate(id) }
        : {}),
    };
  }
  return new AgentService({
    root: join(tmpdir(), "showai-public-catalog"),
  }).catalogDescribe(id, {
    kind: "component",
    scope: "builtin",
    view: input.view ?? "guide",
    file: input.file,
  });
}

/** Rendering has no personal-library or synchronization dependency. Only this invocation's temporary workspace is removed. */
export async function renderPresentation(raw: PresentationInput) {
  const input = z.object(presentationSchema).parse(raw);
  if (input.document && input.templateId)
    throw new Error("Provide document or templateId, not both.");
  if (!input.document && !input.templateId)
    throw new Error("Provide a ShowAI document or a public templateId.");
  let document = input.document
    ? validateDocument(input.document)
    : publicTemplate(input.templateId!);
  if (input.title) document = { ...document, title: input.title };
  const knownKinds = new Set([
    "custom",
    ...listBuiltinComponents({ includeLegacy: true }).map((item) => item.kind),
  ]);
  const validateKinds = (node: ShowDocument["content"]) => {
    if (node.type === "widget" && !knownKinds.has(String(node.attrs?.kind)))
      throw new Error(
        `Unknown widget kind '${node.attrs?.kind}' at node '${node.attrs?.id ?? "unnamed"}'. Custom components use attrs.kind='custom' and attrs.data={componentId,version,props}. The component package ID is not a built-in widget kind.`,
      );
    node.content?.forEach(validateKinds);
  };
  validateKinds(document.content);
  const home = await mkdtemp(join(tmpdir(), "showai-render-"));
  try {
    const store = new FileStore(home);
    const project = await store.createProject({ name: "Presentation" });
    for (const source of input.componentSources ?? [])
      await saveComponent(
        home,
        source as unknown as ComponentSource,
        project.id,
      );
    const components = await resolveDocumentComponents(
      home,
      document,
      project.id,
    );
    document = await lockDocumentComponents(home, document, project.id);
    const validateCustomProps = (node: ShowDocument["content"]) => {
      if (node.type === "widget" && node.attrs?.kind === "custom") {
        const reference = node.attrs.data;
        const component = components.find(
          (item) =>
            item.id === reference.componentId &&
            item.version === reference.version &&
            item.integrity === reference.integrity,
        );
        if (!component)
          throw new Error(
            `Custom component is unavailable: ${reference.componentId}@${reference.version}`,
          );
        assertProps(component.schema, reference.props);
      }
      node.content?.forEach(validateCustomProps);
    };
    validateCustomProps(document.content);
    const html = await buildPageHtml(
      document,
      undefined,
      components,
      [],
      "reading",
    );
    const selected = input.blockIds
      ? selectDocumentBlocks(document, input.blockIds)
      : undefined;
    const inlineHtml = selected
      ? await buildPageHtml(
          selected,
          undefined,
          await resolveDocumentComponents(home, selected, project.id),
          [],
          "reading",
          { blockIds: input.blockIds! },
        )
      : html;
    const preview = inlinePresentation(inlineHtml);
    return {
      title: document.title,
      document,
      html,
      ...preview,
      source: JSON.stringify(
        {
          ...JSON.parse(serializeArtifact(document, components, [], "reading")),
          ...(input.componentSources?.length
            ? { componentSources: input.componentSources }
            : {}),
        },
        null,
        2,
      ),
      persistence: { savedToProject: false, synchronized: false },
      bytes: {
        html: Buffer.byteLength(html),
        inline: preview.inline ? Buffer.byteLength(preview.inline) : null,
      },
    };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

export function inlinePresentation(html: string): {
  inline?: string;
  inlineError?: string;
} {
  try {
    return { inline: toInlineFragment(html) };
  } catch (error) {
    if (
      !(error instanceof CapacityError) ||
      error.kind !== "Compressed chat preview"
    )
      throw error;
    return {
      inlineError: `${error.message} This is the conversation host budget after compression. The complete HTML and source are available. Select independently readable blockIds. If a single selected node still exceeds the budget, use the complete HTML delivery. Page saving and file export use separate budgets.`,
    };
  }
}

export async function writePresentation(
  value: Awaited<ReturnType<typeof renderPresentation>>,
  destination: string,
  overwrite = false,
) {
  const html = resolve(destination);
  if (extname(html).toLowerCase() !== ".html")
    throw new Error("Choose an .html output path.");
  const stem = html.slice(0, -5),
    inline = value.inline ? stem + ".inline.html" : undefined,
    source = stem + ".showai.json";
  const outputs: [string, string][] = [
    [html, value.html],
    [source, value.source],
    ...(inline ? [[inline, value.inline!] as [string, string]] : []),
  ];
  await mkdir(dirname(html), { recursive: true });
  // Fail before writing if any output already exists; replacement is explicit.
  if (!overwrite) {
    const { access } = await import("node:fs/promises");
    for (const [path] of outputs)
      await access(path).then(
        () => {
          throw new Error(`Output already exists: ${path}. Use --overwrite.`);
        },
        (error) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
  }
  for (const [path, contents] of outputs)
    await writeFile(path, contents, {
      flag: overwrite ? "w" : "wx",
      mode: 0o600,
    });
  return {
    title: value.title,
    delivery: { html, ...(inline ? { inline } : {}), source },
    bytes: value.bytes,
    persistence: value.persistence,
    ...(value.inlineError ? { inlineError: value.inlineError } : {}),
  };
}

import { CapacityError } from "../portable/capacity.mjs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, extname } from "node:path";
import { z } from "zod";
import { AgentService } from "./service";
import { builtinTemplateBundles } from "../core/builtin-template-bundles";
import {
  parseTemplateBundle,
  type TemplateStage,
} from "../portable/template-bundle.mjs";
import { templateGuide } from "./template-workflow";
import { catalogPage, type CatalogView } from "./disclosure";
import { FileStore } from "../core/store";
import { buildPageHtml } from "./exporter";
import {
  saveComponent,
  resolveDocumentComponents,
  lockDocumentComponents,
  listBuiltinComponents,
  getTemplate,
  instantiateTemplateRecord,
} from "../core/catalog";
import { toCdnFragment, toCdnPage } from "../portable/cdn-fragment.mjs";
import { cdnReaderUrls } from "../core/cdn-reader";
import { conversationPreview } from "../core/conversation-preview";
import {
  serializeArtifact,
  validateDocument,
} from "../portable/validation.mjs";
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
  templateVersion: z.string().optional(),
  templateIntegrity: z
    .string()
    .regex(/^sha256-[a-f0-9]{64}$/)
    .optional(),
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

const folderTemplateIds = new Set(
  builtinTemplateBundles.map(
    (source) => parseTemplateBundle(source).metadata.id,
  ),
);
const publicCatalogHome = () => join(tmpdir(), "showai-public-catalog");

export function publicTemplate(id: string): ShowDocument {
  throw new Error(
    `Unknown public template: ${id}. Public templates are the builtin folder templates listed by public_catalog_list.`,
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
  const folders =
    input.kind === "component"
      ? []
      : (
          await new AgentService({ root: publicCatalogHome() }).catalogList({
            kind: "template",
            scope: "builtin",
            query: input.query,
          })
        ).items.filter((item) => folderTemplateIds.has(item.id));
  const items = [...components, ...folders];
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
    parameterPath?: string;
    parameterOffset?: number;
    parameterLimit?: number;
    knownHash?: string;
    stage?: TemplateStage;
    version?: string;
    integrity?: string;
  } = {},
) {
  if (
    input.view === "parameters" &&
    (input.kind === "template" ||
      (input.kind !== "component" && folderTemplateIds.has(id)))
  )
    throw new Error("Parameter references belong to components.");
  if (folderTemplateIds.has(id) && input.kind !== "component") {
    const template = await getTemplate(publicCatalogHome(), id, undefined, {
      scope: "builtin",
      version: input.version,
      integrity: input.integrity,
    });
    if (input.stage)
      return templateGuide(
        publicCatalogHome(),
        "public",
        input.stage,
        [
          {
            id,
            version: template.version,
            integrity: template.integrity,
            scope: "builtin",
          },
        ],
        undefined,
        input.file,
        input.file ? id : undefined,
      );
    const result = await new AgentService({
      root: publicCatalogHome(),
    }).catalogDescribe(id, {
      kind: "template",
      scope: "builtin",
      version: template.version,
      integrity: template.integrity,
      view: input.view ?? "guide",
    });
    return {
      ...result,
      next: {
        stage: {
          tool: "public_catalog_describe",
          arguments: {
            id,
            kind: "template",
            view: "guide",
            version: template.version,
            integrity: template.integrity,
            stage: "intent",
          },
        },
        source: {
          tool: "public_catalog_describe",
          arguments: {
            id,
            kind: "template",
            view: "source",
            version: template.version,
            integrity: template.integrity,
          },
        },
      },
    };
  }
  if (input.kind === "template" || input.stage) publicTemplate(id);
  return new AgentService({
    root: join(tmpdir(), "showai-public-catalog"),
  }).catalogDescribe(id, {
    kind: "component",
    scope: "builtin",
    version: input.version,
    integrity: input.integrity,
    view: input.view ?? "guide",
    file: input.file,
    parameterPath: input.parameterPath,
    parameterOffset: input.parameterOffset,
    parameterLimit: input.parameterLimit,
    knownHash: input.knownHash,
  });
}

/** Rendering has no personal-library or synchronization dependency. Only this invocation's temporary workspace is removed. */
export async function renderPresentation(raw: PresentationInput) {
  const input = z.object(presentationSchema).parse(raw);
  if (input.document && input.templateId)
    throw new Error("Provide document or templateId, not both.");
  if (!input.document && !input.templateId)
    throw new Error("Provide a ShowAI document or a public templateId.");
  if (
    input.templateId &&
    !folderTemplateIds.has(input.templateId) &&
    (input.templateIntegrity ||
      (input.templateVersion && input.templateVersion !== "1.0.0"))
  )
    throw new Error(
      "Legacy public presets do not expose a versioned template fingerprint. Read their source and render an explicit document, or select a folder template.",
    );
  let document = input.document
    ? validateDocument(input.document)
    : folderTemplateIds.has(input.templateId!)
      ? await instantiateTemplateRecord(
          publicCatalogHome(),
          await getTemplate(publicCatalogHome(), input.templateId!, undefined, {
            scope: "builtin",
            version: input.templateVersion,
            integrity: input.templateIntegrity,
          }),
        )
      : publicTemplate(input.templateId!);
  if (!input.templateId && (input.templateVersion || input.templateIntegrity))
    throw new Error("Template version/integrity require templateId.");
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
        assertProps(component.schema, reference.props, component.documentation);
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
    const preview = await inlinePresentation(inlineHtml);
    const online = await onlinePresentation(html);
    const compact = await compactPresentation(inlineHtml);
    return {
      title: document.title,
      document,
      html,
      ...preview,
      ...(online ? { online } : {}),
      ...(compact ? { compact } : {}),
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
        online: online ? Buffer.byteLength(online) : null,
        compact: compact ? Buffer.byteLength(compact) : null,
      },
    };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

/**
 * The conversation preview carries its local reader when it fits the host;
 * a published CDN reader is used only when the compressed bundle is too large.
 */
export async function inlinePresentation(html: string): Promise<{
  inline?: string;
  inlineError?: string;
}> {
  try {
    const { inline } = await conversationPreview(html);
    return { inline };
  } catch (error) {
    if (
      !(error instanceof CapacityError) ||
      !["Compressed chat preview", "CDN chat preview"].includes(error.kind)
    )
      throw error;
    return {
      inlineError: `${error.message} This is the conversation host budget; bundled previews are measured after compression and CDN previews carry page data, embedded images and custom components. The complete HTML and source are available. Select independently readable blockIds. If a single selected node still exceeds the budget, use the complete HTML delivery. Page saving and file export use separate budgets.`,
    };
  }
}

/**
 * A few-kilobyte preview fragment that loads the published reader, for hosts
 * where the model writes the HTML itself; undefined without a CDN reader.
 */
export async function compactPresentation(html: string) {
  const urls = await cdnReaderUrls();
  if (!urls) return undefined;
  try {
    return toCdnFragment(html, { readerUrls: urls });
  } catch (error) {
    if (error instanceof CapacityError) return undefined;
    throw error;
  }
}

/** A complete page that loads the CDN reader, or undefined without one. */
export async function onlinePresentation(html: string) {
  const urls = await cdnReaderUrls();
  return urls ? toCdnPage(html, { readerUrls: urls }) : undefined;
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
    online = value.online ? stem + ".online.html" : undefined,
    compact = value.compact ? stem + ".compact.html" : undefined,
    source = stem + ".showai.json";
  const outputs: [string, string][] = [
    [html, value.html],
    [source, value.source],
    ...(inline ? [[inline, value.inline!] as [string, string]] : []),
    ...(online ? [[online, value.online!] as [string, string]] : []),
    ...(compact ? [[compact, value.compact!] as [string, string]] : []),
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
    delivery: {
      html,
      ...(inline ? { inline } : {}),
      ...(online ? { online } : {}),
      ...(compact ? { compact } : {}),
      source,
    },
    bytes: value.bytes,
    persistence: value.persistence,
    ...(value.inlineError ? { inlineError: value.inlineError } : {}),
  };
}

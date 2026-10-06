import {
  remapSurfaceIds,
  isSurface,
  upgradeDocument,
} from "../surface/document.mjs";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { build, type Plugin } from "esbuild";
import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";
import templates from "../../resources/catalog/templates.json";
import builtinComponents from "../../resources/catalog/components.json";
import primitiveComponents from "../../resources/catalog/primitives.json";
import { builtinSources, builtinExports } from "./builtin-sources";
import { validateDocument } from "../portable/validation.mjs";
import type { ShowDocument } from "../types";
import { canonicalJson } from "./diff";
import { mergeValues } from "./catalog-merge";
import { assertJsonValue, assertProps } from "../components/custom/schema";
import {
  COMPONENT_DATA_MARKER,
  COMPONENT_ID,
  COMPONENT_VERSION,
  collectCustomComponentRefs,
  componentWidgetData as browserComponentWidgetData,
} from "../components/custom/contract";
import type {
  BuiltinComponentMetadata,
  CatalogScope,
  CompiledComponent,
  ComponentManifest,
  ComponentMetadata,
  ComponentSource,
  JsonSchema,
  TemplateMetadata,
  TemplateRecord,
  CatalogReadOptions,
  PackageRevisionRef,
  PackageBundle,
  SaveTemplateInput,
  TemplatePart,
  EditablePackage,
  PackageMergeInput,
  PackageMergePreview,
} from "../components/custom/types";
import { componentCategories, componentCategory } from "./component-categories";

export type {
  CompiledComponent,
  ComponentManifest,
  ComponentMetadata,
  ComponentSource,
  TemplateMetadata,
  TemplateRecord,
  CatalogReadOptions,
  PackageRevisionRef,
  PackageBundle,
  SaveTemplateInput,
  EditablePackage,
  PackageMergeInput,
  PackageMergePreview,
} from "../components/custom/types";

export function listBuiltinComponents(): BuiltinComponentMetadata[] {
  return structuredClone([
    ...primitiveComponents,
    ...builtinComponents,
  ]) as BuiltinComponentMetadata[];
}
export function describeBuiltinComponent(
  kind: string,
): BuiltinComponentMetadata {
  const component = listBuiltinComponents().find((item) => item.kind === kind);
  if (!component) throw new Error(`Built-in component not found: ${kind}.`);
  return component;
}

export function readBuiltinComponentSource(kind: string): ComponentSource {
  const item = describeBuiltinComponent(kind);
  const exported = builtinExports[kind];
  if (!exported) throw new Error(`No editable source for ${kind}.`);
  const source = `import { ${exported} } from "showai:components";

export default function Component({ data, onChange, readOnly }) {
  return <${exported} data={data} onChange={onChange} readOnly={readOnly} />;
}
`;
  return {
    manifest: {
      id: kind,
      name: item.name,
      version: item.version ?? "1.0.0",
      description: item.description,
      category: componentCategory(item),
      scenarios: item.scenarios,
      effects: item.effects,
      entry: "index.tsx",
      defaultData: item.defaultData,
      examples: item.examples,
    },
    schema: item.propsSchema,
    source,
    files: { "index.tsx": source },
  };
}

const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".woff2",
]);
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".css",
]);
const emptyContent = { type: "doc", content: [{ type: "paragraph" }] };

function assertId(id: string): void {
  if (!COMPONENT_ID.test(id))
    throw new Error(
      "Catalog ids must use lowercase letters, numbers and hyphens.",
    );
}
function assertVersion(version: string): void {
  if (!COMPONENT_VERSION.test(version))
    throw new Error(
      "Component version must be an exact semantic version, such as 1.0.0.",
    );
}
function projectRoot(home: string, projectId?: string): string {
  if (projectId === undefined) return resolve(home);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(projectId) ||
    /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(projectId)
  )
    throw new Error("Invalid project id.");
  return join(resolve(home), "projects", projectId);
}
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}
async function optionalStat(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}
/** Every descendant is checked, including the final file, before catalog I/O. */
async function safePath(
  home: string,
  path: string,
  createParent = false,
): Promise<string> {
  const base = resolve(home),
    target = resolve(path);
  if (!inside(base, target)) throw new Error("Catalog path escapes its home.");
  await mkdir(base, { recursive: true });
  if ((await lstat(base)).isSymbolicLink())
    throw new Error("Catalog home cannot be a symbolic link.");
  const parts = relative(base, target).split(sep).filter(Boolean);
  let current = base;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = await optionalStat(current);
    if (stat?.isSymbolicLink())
      throw new Error("Symbolic links are not allowed inside the catalog.");
    if (index < parts.length - 1) {
      if (stat && !stat.isDirectory())
        throw new Error("Catalog parent is not a directory.");
      if (!stat && createParent) await mkdir(current, { recursive: true });
    }
  }
  return target;
}
async function readJson(home: string, path: string): Promise<unknown> {
  await safePath(home, path);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 12 * 1024 * 1024)
    throw new Error("Invalid catalog file.");
  return JSON.parse(await readFile(path, "utf8"));
}
function packageBase(
  home: string,
  kind: "templates" | "components",
  projectId?: string,
  scope?: CatalogScope,
): string {
  if (scope === "published")
    return join(resolve(home), "packages", "published", kind);
  return join(projectRoot(home, projectId), "packages", kind);
}
function locations(
  home: string,
  kind: "templates" | "components",
  projectId?: string,
  options: CatalogReadOptions = {},
): { path: string; scope: CatalogScope }[] {
  if (options.scope === "project" && !projectId)
    throw new Error("A project scope requires projectId.");
  return [
    ...(projectId
      ? [
          {
            path: packageBase(home, kind, projectId),
            scope: "project" as const,
          },
        ]
      : []),
    { path: packageBase(home, kind), scope: "global" as const },
    {
      path: packageBase(home, kind, undefined, "published"),
      scope: "published" as const,
    },
  ].filter(
    (location) =>
      !options.scope ||
      options.scope === "all" ||
      location.scope === options.scope,
  );
}

async function requireProjectWrite(
  home: string,
  projectId?: string,
): Promise<string> {
  if (!projectId)
    throw new Error(
      "A projectId is required for catalog writes. Promote a project revision explicitly to add it to the global catalog.",
    );
  const project = (await readJson(
    home,
    join(projectRoot(home, projectId), "project.json"),
  )) as Record<string, unknown>;
  if (
    project.id !== projectId ||
    project.format !== "showai-project" ||
    project.archived
  )
    throw new Error(
      "The catalog destination must be an existing active project.",
    );
  return projectId;
}

function revisionIdentity(ref: PackageRevisionRef): string {
  return `${ref.kind}:${ref.id}@${ref.version}:${ref.integrity}`;
}
export function packageRevisionRef(
  kind: "component" | "template",
  item: {
    id: string;
    version: string;
    integrity: string;
    scope?: CatalogScope;
  },
): PackageRevisionRef {
  return {
    kind,
    id: item.id,
    version: item.version,
    integrity: item.integrity,
    ...(item.scope ? { scope: item.scope } : {}),
  };
}
function checkedRef(
  value: unknown,
  expectedKind?: "component" | "template",
): PackageRevisionRef {
  const ref = record(value, "Package reference");
  if (
    (ref.kind !== "component" && ref.kind !== "template") ||
    (expectedKind && ref.kind !== expectedKind)
  )
    throw new Error("Invalid package reference kind.");
  if (typeof ref.id !== "string" || typeof ref.version !== "string")
    throw new Error("Package references need textual id and exact version.");
  assertId(String(ref.id));
  assertVersion(String(ref.version));
  if (
    typeof ref.integrity !== "string" ||
    !/^sha256-[a-f0-9]{64}$/.test(ref.integrity)
  )
    throw new Error(
      "An exact package reference requires its integrity fingerprint.",
    );
  if (
    ref.scope !== undefined &&
    !["project", "global", "published", "builtin"].includes(String(ref.scope))
  )
    throw new Error("Invalid package scope.");
  if (ref.projectId !== undefined) projectRoot(".", String(ref.projectId));
  return {
    kind: ref.kind,
    id: String(ref.id),
    version: String(ref.version),
    integrity: ref.integrity,
    ...(ref.scope ? { scope: ref.scope as CatalogScope } : {}),
    ...(ref.projectId ? { projectId: String(ref.projectId) } : {}),
  };
}
function portableRef(ref: PackageRevisionRef): PackageRevisionRef {
  const { kind, id, version, integrity } = checkedRef(ref);
  return { kind, id, version, integrity };
}
function textList(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`${name} must be an array of text.`);
  return value;
}
function compareVersion(left: string, right: string): number {
  const [a, apre] = left.split("-"),
    [b, bpre] = right.split("-");
  const an = a.split(".").map(Number),
    bn = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (an[i] !== bn[i]) return an[i] - bn[i];
  if (!apre && bpre) return 1;
  if (apre && !bpre) return -1;
  return (apre ?? "").localeCompare(bpre ?? "", undefined, { numeric: true });
}
async function children(home: string, path: string): Promise<string[]> {
  await safePath(home, path);
  if (!(await optionalStat(path))) return [];
  return readdir(path);
}
function documentCopy(document: ShowDocument): ShowDocument {
  return validateDocument(JSON.parse(JSON.stringify(document))) as ShowDocument;
}
function templateIntegrity(item: TemplateRecord): string {
  const {
    scope: _scope,
    updatedAt: _date,
    integrity: _integrity,
    legacy: _legacy,
    document,
    ...fields
  } = item;
  const {
    id: _id,
    createdAt: _created,
    updatedAt: _updated,
    parentId: _parent,
    favorite: _favorite,
    archived: _archived,
    ...content
  } = document;
  return digest(canonicalJson({ ...fields, document: content }));
}
function relatedItems(value: unknown): TemplateMetadata["related"] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error("Related packages must be an array.");
  return value.map((value) => {
    const item = record(value, "Related package");
    if (
      !["component", "template"].includes(String(item.kind)) ||
      typeof item.purpose !== "string"
    )
      throw new Error("Related packages need kind and purpose.");
    assertId(String(item.id));
    if (item.version !== undefined) assertVersion(String(item.version));
    return {
      kind: item.kind as "component" | "template",
      id: String(item.id),
      purpose: item.purpose,
      ...(item.version ? { version: String(item.version) } : {}),
    };
  });
}
function templateRecord(
  value: unknown,
  scope: CatalogScope,
  verify = true,
): TemplateRecord {
  const item = record(value, "Template");
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    !item.name.trim() ||
    typeof item.description !== "string" ||
    typeof item.updatedAt !== "string"
  )
    throw new Error("Invalid template metadata.");
  assertId(item.id);
  const legacy = item.version === undefined || item.legacy === true;
  const version = legacy ? "0.0.0-legacy" : String(item.version);
  assertVersion(version);
  const guide = item.contentGuide ?? [];
  if (!Array.isArray(guide))
    throw new Error("Template contentGuide must be an array.");
  const examples = item.examples ?? [];
  if (!Array.isArray(examples))
    throw new Error("Template examples must be an array.");
  const composition =
    item.composition === undefined
      ? undefined
      : (() => {
          if (!Array.isArray(item.composition) || item.composition.length > 100)
            throw new Error(
              "Template composition must contain at most 100 ordered parts.",
            );
          return item.composition.map((value, index): TemplatePart => {
            const part = record(value, "Template part");
            if (part.type === "content") {
              const node = record(
                part.content,
                "Template content",
              ) as ShowDocument["content"];
              const normalized = documentCopy({
                ...blankDocument(),
                id: `${item.id}:part:${index}`,
                content: ["doc", "surface"].includes(node.type ?? "")
                  ? node
                  : { type: "doc", content: [node] },
                ...(part.layout
                  ? { layout: part.layout as ShowDocument["layout"] }
                  : {}),
                ...(part.views
                  ? { views: part.views as ShowDocument["views"] }
                  : {}),
              });
              if (node.type === "surface")
                return {
                  type: "content",
                  content: normalized.content,
                  layout: normalized.layout,
                  views: normalized.views,
                };
              return {
                type: "content",
                content: structuredClone(node),
                ...(part.layout
                  ? {
                      layout: structuredClone(
                        part.layout,
                      ) as ShowDocument["layout"],
                    }
                  : {}),
                ...(part.views
                  ? {
                      views: structuredClone(
                        part.views,
                      ) as ShowDocument["views"],
                    }
                  : {}),
              };
            }
            if (
              part.type !== "template" ||
              (part.title !== undefined && typeof part.title !== "string")
            )
              throw new Error("Unknown template composition part.");
            return {
              type: "template",
              ref: portableRef(checkedRef(part.ref, "template")),
              ...(part.title !== undefined
                ? { title: part.title as string }
                : {}),
            };
          });
        })();
  const dependencies = item.dependencies ?? [];
  if (!Array.isArray(dependencies))
    throw new Error("Template dependencies must be an array.");
  if (item.parents !== undefined && !Array.isArray(item.parents))
    throw new Error("Template parents must be an array.");
  const result: TemplateRecord = {
    id: item.id,
    name: item.name.trim(),
    description: item.description,
    version,
    integrity: "",
    scope,
    updatedAt: item.updatedAt,
    document: documentCopy(item.document as ShowDocument),
    scenarios: textList(item.scenarios, "Template scenarios"),
    contentGuide: guide.map((value) => {
      const row = record(value, "Content guide");
      if (typeof row.title !== "string")
        throw new Error("Content guide needs a title.");
      return {
        title: row.title,
        instructions: textList(row.instructions, "Content instructions"),
      };
    }),
    related: relatedItems(item.related),
    examples: examples.map((value) => {
      const example = record(value, "Template example");
      if (
        typeof example.name !== "string" ||
        typeof example.request !== "string"
      )
        throw new Error("Template examples need name and request.");
      return {
        name: example.name,
        request: example.request,
        steps: relatedItems(example.steps),
      };
    }),
    dependencies: dependencies.map((ref) => portableRef(checkedRef(ref))),
    ...(composition ? { composition } : {}),
    ...(item.parents
      ? { parents: (item.parents as unknown[]).map((ref) => checkedRef(ref)) }
      : {}),
    ...(item.mergeBase ? { mergeBase: checkedRef(item.mergeBase) } : {}),
    ...(legacy ? { legacy: true } : {}),
  };
  result.integrity = templateIntegrity(result);
  if (verify && !legacy && item.integrity !== result.integrity)
    throw new Error(
      `Template integrity verification failed: ${result.id}@${result.version}.`,
    );
  return result;
}
function builtinTemplate(id: string): TemplateRecord | undefined {
  const item = templates.find((template) => template.id === id);
  if (!item) return undefined;
  const date = "2026-10-03T00:00:00.000Z";
  return templateRecord(
    {
      ...item,
      version: "1.0.0",
      updatedAt: date,
      dependencies: [],
      document: {
        ...blankDocument(),
        id: `template-${id}`,
        title: id === "blank" ? "" : item.name,
        createdAt: date,
        updatedAt: date,
        content: { type: "doc", content: item.content },
      },
    },
    "builtin",
    false,
  );
}
async function templatesAt(
  home: string,
  path: string,
  scope: CatalogScope,
): Promise<TemplateRecord[]> {
  const result: TemplateRecord[] = [];
  for (const name of (await children(home, path)).sort()) {
    if (name.endsWith(".json") && COMPONENT_ID.test(name.slice(0, -5)))
      result.push(
        templateRecord(await readJson(home, join(path, name)), scope),
      );
    else if (COMPONENT_ID.test(name)) {
      for (const version of (await children(home, join(path, name)))
        .filter((version) => COMPONENT_VERSION.test(version))
        .sort((a, b) => compareVersion(b, a))) {
        const entry = join(path, name, version, "template.json");
        const template = templateRecord(await readJson(home, entry), scope);
        if (template.id !== name || template.version !== version)
          throw new Error("Template path and identity differ.");
        result.push(template);
      }
    }
  }
  return result;
}
export async function listTemplates(
  home: string,
  projectId?: string,
  options: CatalogReadOptions = {},
): Promise<TemplateMetadata[]> {
  const result: TemplateMetadata[] = [];
  for (const location of locations(home, "templates", projectId, options)) {
    for (const item of await templatesAt(home, location.path, location.scope)) {
      const {
        document: _document,
        composition: _composition,
        ...metadata
      } = item;
      result.push(metadata);
    }
  }
  if (!options.scope || options.scope === "all" || options.scope === "builtin")
    for (const spec of templates) {
      const {
        document: _document,
        composition: _composition,
        ...metadata
      } = builtinTemplate(spec.id)!;
      result.push(metadata);
    }
  return result;
}
export async function getTemplate(
  home: string,
  id: string,
  projectId?: string,
  options: CatalogReadOptions = {},
): Promise<TemplateRecord> {
  assertId(id);
  if (options.version) assertVersion(options.version);
  for (const location of locations(home, "templates", projectId, options)) {
    const candidates: TemplateRecord[] = [];
    const versionRoot = join(location.path, id);
    if (await optionalStat(await safePath(home, versionRoot))) {
      const versions = options.version
        ? [options.version]
        : (await children(home, versionRoot))
            .filter((version) => COMPONENT_VERSION.test(version))
            .sort((a, b) => compareVersion(b, a));
      for (const version of versions) {
        const path = await safePath(
          home,
          join(versionRoot, version, "template.json"),
        );
        if (await optionalStat(path))
          candidates.push(
            templateRecord(await readJson(home, path), location.scope),
          );
      }
    }
    const flat = await safePath(home, join(location.path, `${id}.json`));
    if (
      (!options.version || options.version === "0.0.0-legacy") &&
      (await optionalStat(flat))
    )
      candidates.push(
        templateRecord(await readJson(home, flat), location.scope),
      );
    const match = candidates.find(
      (item) =>
        (!options.version || item.version === options.version) &&
        (!options.integrity || item.integrity === options.integrity),
    );
    if (match) return match;
  }
  if (
    !options.scope ||
    options.scope === "all" ||
    options.scope === "builtin"
  ) {
    const item = builtinTemplate(id);
    if (
      item &&
      (!options.version || item.version === options.version) &&
      (!options.integrity || item.integrity === options.integrity)
    )
      return item;
  }
  throw new Error(
    `Exact template not found: ${id}${options.version ? `@${options.version}` : ""}${options.integrity ? ` (integrity ${options.integrity})` : ""}.`,
  );
}
export async function getTemplateByRef(
  home: string,
  input: PackageRevisionRef,
  projectId?: string,
): Promise<TemplateRecord> {
  const ref = checkedRef(input, "template");
  return getTemplate(home, ref.id, ref.projectId ?? projectId, {
    version: ref.version,
    integrity: ref.integrity,
    scope: ref.scope,
  });
}
async function writeTemplateRevision(
  home: string,
  template: TemplateRecord,
  scope: "project" | "global" | "published",
  projectId?: string,
): Promise<TemplateRecord> {
  if (Buffer.byteLength(JSON.stringify(template)) > 12 * 1024 * 1024)
    throw new Error("Template source exceeds the 12 MB catalog record limit.");
  const destination = await safePath(
    home,
    join(
      packageBase(
        home,
        "templates",
        scope === "project" ? projectId : undefined,
        scope,
      ),
      template.id,
      template.version,
    ),
    true,
  );
  if (await optionalStat(destination)) {
    const current = templateRecord(
      await readJson(home, join(destination, "template.json")),
      scope,
    );
    if (current.integrity !== template.integrity)
      throw new Error(
        `Template ${template.id}@${template.version} is immutable. Save a new version.`,
      );
    return current;
  }
  const staging = join(dirname(destination), `.template-${randomUUID()}`);
  await mkdir(staging);
  try {
    await writeFile(
      join(staging, "template.json"),
      JSON.stringify({ ...template, scope }, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await rename(staging, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { ...template, scope };
}
export async function saveTemplate(
  home: string,
  input: SaveTemplateInput,
  projectId?: string,
): Promise<TemplateRecord> {
  const project = await requireProjectWrite(home, projectId);
  const id = input.id ?? `template-${randomUUID()}`,
    version = input.version ?? "1.0.0";
  assertId(id);
  assertVersion(version);
  if (version === "0.0.0-legacy")
    throw new Error("Legacy flat templates are read-only. Save a new version.");
  const document = await lockDocumentComponents(
    home,
    documentCopy(input.document ?? blankDocument()),
    project,
  );
  const dependencies = new Map<string, PackageRevisionRef>();
  const addComponents = async (doc: ShowDocument) => {
    for (const component of await resolveDocumentComponents(
      home,
      doc,
      project,
    )) {
      const ref = portableRef(packageRevisionRef("component", component));
      dependencies.set(revisionIdentity(ref), ref);
    }
  };
  const composition: TemplatePart[] | undefined = input.composition
    ? []
    : undefined;
  if (input.composition)
    for (const part of input.composition) {
      if (part.type === "content") {
        const value = await lockDocumentComponents(
          home,
          {
            ...blankDocument(),
            content: ["doc", "surface"].includes(part.content.type ?? "")
              ? part.content
              : { type: "doc", content: [part.content] },
            ...(part.layout ? { layout: part.layout } : {}),
            ...(part.views ? { views: part.views } : {}),
          },
          project,
        );
        composition!.push({
          type: "content",
          content: value.content,
          ...(value.layout ? { layout: value.layout, views: value.views } : {}),
        });
        await addComponents(value);
      } else {
        if (part.type !== "template" || part.ref.kind !== "template")
          throw new Error("Invalid template composition part.");
        const nested = await getTemplate(
          home,
          part.ref.id,
          part.ref.projectId ?? project,
          {
            version: part.ref.version,
            integrity: part.ref.integrity,
            scope: part.ref.scope,
          },
        );
        if (nested.id === id && nested.version === version)
          throw new Error("Template composition contains a cycle.");
        const ref = portableRef(packageRevisionRef("template", nested));
        composition!.push({
          type: "template",
          ref,
          ...(part.title ? { title: part.title } : {}),
        });
        dependencies.set(revisionIdentity(ref), ref);
        await instantiateTemplateRecord(home, nested, project);
        const nestedBundle = await resolvePackageBundle(
          home,
          packageRevisionRef("template", nested),
          project,
        );
        for (const item of nestedBundle.templates) {
          const dependency = portableRef(packageRevisionRef("template", item));
          dependencies.set(revisionIdentity(dependency), dependency);
        }
        for (const { component } of nestedBundle.components) {
          const dependency = portableRef(
            packageRevisionRef("component", component),
          );
          dependencies.set(revisionIdentity(dependency), dependency);
        }
      }
    }
  else await addComponents(document);
  const item = templateRecord(
    Object.fromEntries(
      Object.entries({
        name: input.name,
        description: input.description,
        scenarios: input.scenarios,
        contentGuide: input.contentGuide,
        related: input.related,
        examples: input.examples,
        parents: input.parents,
        mergeBase: input.mergeBase,
        id,
        version,
        document,
        composition,
        dependencies: [...dependencies.values()],
        updatedAt: new Date().toISOString(),
      }).filter(([, value]) => value !== undefined),
    ),
    "project",
    false,
  );
  await instantiateTemplateRecord(home, item, project);
  return writeTemplateRevision(home, item, "project", project);
}
export function instantiateTemplate(document: ShowDocument): ShowDocument {
  const copy = remapSurfaceIds(documentCopy(document), randomUUID),
    date = new Date().toISOString();
  return {
    ...copy,
    id: randomUUID(),
    createdAt: date,
    updatedAt: date,
    favorite: false,
    archived: false,
    parentId: null,
    comments: [],
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  assertJsonValue(value);
  return value as Record<string, unknown>;
}
function manifestFrom(value: unknown): ComponentManifest {
  const item = record(value, "Component manifest");
  if (
    item.category !== undefined &&
    !componentCategories.some(({ id }) => id === item.category)
  )
    throw new Error(
      "Component category must be text, image, table, data, flow or other.",
    );
  for (const key of ["id", "name", "version", "description", "entry"])
    if (typeof item[key] !== "string" || (item[key] as string).length > 4000)
      throw new Error(`Component manifest needs ${key}.`);
  const id = item.id as string,
    version = item.version as string,
    entry = item.entry as string;
  assertId(id);
  assertVersion(version);
  if (!(item.name as string).trim())
    throw new Error("A component needs a name.");
  if (
    isAbsolute(entry) ||
    entry.includes("\\") ||
    entry.split("/").some((part) => part === "..") ||
    !/\.[jt]sx?$/.test(entry)
  )
    throw new Error(
      "Component entry must be a local JavaScript or TypeScript file.",
    );
  if (
    !Array.isArray(item.scenarios) ||
    item.scenarios.some((item) => typeof item !== "string")
  )
    throw new Error("Component scenarios must be an array of text.");
  const defaultData = record(item.defaultData, "Component defaultData");
  if (!Array.isArray(item.examples))
    throw new Error("Component examples must be an array.");
  const examples = item.examples.map((value) => {
    const example = record(value, "Component example");
    if (typeof example.name !== "string")
      throw new Error("Each component example needs a name.");
    for (const key of ["request", "description"])
      if (example[key] !== undefined && typeof example[key] !== "string")
        throw new Error(`Component example ${key} must be text.`);
    return {
      name: example.name,
      data: record(example.data, "Example data"),
      ...(example.request !== undefined
        ? { request: example.request as string }
        : {}),
      ...(example.description !== undefined
        ? { description: example.description as string }
        : {}),
    };
  });
  return {
    id,
    version,
    name: (item.name as string).trim(),
    description: item.description as string,
    ...(item.category !== undefined
      ? { category: item.category as ComponentManifest["category"] }
      : {}),
    entry,
    scenarios: item.scenarios as string[],
    defaultData,
    examples,
    ...(item.effects !== undefined
      ? { effects: textList(item.effects, "Component effects") }
      : {}),
    ...(item.dependencies !== undefined
      ? { dependencies: componentDependencies(item.dependencies) }
      : {}),
    ...(item.parents !== undefined
      ? {
          parents: Array.isArray(item.parents)
            ? item.parents.map((ref) => checkedRef(ref))
            : (() => {
                throw new Error("Component parents must be an array.");
              })(),
        }
      : {}),
    ...(item.mergeBase ? { mergeBase: checkedRef(item.mergeBase) } : {}),
  };
}
function componentDependencies(value: unknown): PackageRevisionRef[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error(
      "Component dependencies must be an array of at most 100 exact references.",
    );
  const refs = value.map((ref) => portableRef(checkedRef(ref, "component")));
  if (new Set(refs.map((ref) => ref.id)).size !== refs.length)
    throw new Error(
      "Component dependency ids must be unique within a package.",
    );
  return refs;
}

async function packageFiles(directory: string): Promise<Map<string, Buffer>> {
  const root = await realpath(directory);
  const files = new Map<string, Buffer>();
  let bytes = 0;
  const walk = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (
        ["node_modules", ".git", "compiled.json"].includes(entry.name) ||
        entry.name.startsWith(".")
      )
        continue;
      const target = join(path, entry.name),
        stat = await lstat(target);
      if (stat.isSymbolicLink())
        throw new Error("Component packages cannot contain symbolic links.");
      if (stat.isDirectory()) {
        await walk(target);
        continue;
      }
      if (
        !stat.isFile() ||
        !SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())
      )
        continue;
      bytes += stat.size;
      if (files.size >= MAX_FILES || bytes > MAX_PACKAGE_BYTES)
        throw new Error("Component package exceeds the 200-file / 8 MB limit.");
      files.set(
        relative(root, target).split(sep).join("/"),
        await readFile(target),
      );
    }
  };
  await walk(root);
  return files;
}
function digest(value: string | Buffer): string {
  return `sha256-${createHash("sha256").update(value).digest("hex")}`;
}
function sourceDigest(files: Map<string, Buffer>): string {
  const hash = createHash("sha256");
  for (const [name, content] of [...files.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  ))
    hash.update(name).update("\0").update(content).update("\0");
  return `sha256-${hash.digest("hex")}`;
}
function compiledIntegrity(
  component: Pick<
    CompiledComponent,
    keyof ComponentManifest | "html" | "schema" | "inline"
  >,
): string {
  const manifest = manifestFrom(component);
  return digest(
    JSON.stringify({
      manifest,
      schema: component.schema,
      html: component.html,
      ...(component.inline ? { inline: component.inline } : {}),
    }),
  );
}

function runtimeSource(entry: string): string {
  return `import React, {useState} from 'react';import{createRoot}from'react-dom/client';import UserComponent from ${JSON.stringify(entry)};import validate from 'showai:validator';
const config=JSON.parse(document.getElementById('showai-component-data')?.textContent||'{}');const channel=config.channel;
const send=(type,extra={})=>parent.postMessage({channel,type,...extra},'*');let update;
const validationMessage=()=>(validate.errors||[]).map(error=>(error.instancePath||error.params?.missingProperty||'data')+' '+error.message).join('; ');
function check(props){if(validate(props))return true;send('showai:error',{message:validationMessage()});return false;}
function App(){const[state,setState]=useState({data:config.props||{},readOnly:config.readOnly!==false});update=(data,readOnly)=>{if(check(data)){setState({data,readOnly});send('showai:valid')}};return React.createElement(UserComponent,{...state,onChange:state.readOnly?undefined:(data)=>{if(check(data)){setState(s=>({...s,data}));send('showai:change',{props:data});}}});}
window.addEventListener('message',event=>{if(event.source!==parent||event.data?.channel!==channel)return;if(event.data?.type==='showai:validate'){const valid=validate(event.data.props);send('showai:validation',{requestId:event.data.requestId,valid,message:valid?'':validationMessage()});return;}if(event.data?.type==='showai:props')update?.(event.data.props,event.data.readOnly!==false);});
window.addEventListener('error',event=>send('showai:error',{message:event.message}));window.addEventListener('unhandledrejection',event=>send('showai:error',{message:String(event.reason?.message||event.reason)}));
createRoot(document.getElementById('component-root')).render(React.createElement(App));
new ResizeObserver(()=>send('showai:height',{height:Math.ceil(document.getElementById('component-root').getBoundingClientRect().height)+2})).observe(document.getElementById('component-root'));send('showai:ready');`;
}

function inlineRuntimeSource(entry: string): string {
  return `import React from 'react';import{createRoot}from'react-dom/client';import UserComponent from ${JSON.stringify(entry)};import validate from 'showai:validator';
export function mount(target,initial){const root=createRoot(target,{onUncaughtError:error=>initial.onError(String(error?.message||error))});
const render=data=>{if(!validate(data)){initial.onError((validate.errors||[]).map(error=>(error.instancePath||'data')+' '+error.message).join('; '));return;}initial.onError('');root.render(React.createElement(UserComponent,{data,readOnly:true,onChange:undefined}));};render(initial.data);return{update:render,destroy:()=>root.unmount()};}`;
}

async function compilePackage(
  directory: string,
  manifest: ComponentManifest,
  schema: JsonSchema,
  files: Map<string, Buffer>,
  scope: CatalogScope,
  home: string,
  projectId?: string,
): Promise<CompiledComponent> {
  const require = createRequire(
    process.env.SHOWAI_RUNTIME_ENTRY ?? import.meta.url,
  );
  assertProps(schema, manifest.defaultData);
  manifest.examples.forEach((example) => assertProps(schema, example.data));
  const root = await realpath(directory);
  if (!files.has(manifest.entry.replace(/^\.\//, "")))
    throw new Error("The component entry does not exist inside the package.");
  const ajv = new Ajv({
    strict: true,
    allowUnionTypes: true,
    addUsedSchema: false,
    validateFormats: false,
    code: { source: true, esm: true },
    allErrors: true,
  });
  const validator = standaloneCode(ajv, ajv.compile(schema));
  const runtimeRoots = new Map<string, string>();
  const includeRuntime = (name: string): void => {
    if (runtimeRoots.has(name)) return;
    let directory = dirname(require.resolve(name));
    while (true) {
      const metadataPath = join(directory, "package.json");
      if (existsSync(metadataPath)) {
        const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
        if (metadata.name === name) {
          runtimeRoots.set(name, directory);
          Object.keys(metadata.dependencies ?? {})
            .filter((name) => !name.startsWith("@types/"))
            .forEach(includeRuntime);
          return;
        }
      }
      const parent = dirname(directory);
      if (parent === directory)
        throw new Error(`Missing installed runtime package: ${name}`);
      directory = parent;
    }
  };
  [
    "react",
    "react-dom",
    "scheduler",
    "ajv",
    "marked",
    "lucide-react",
    "@xyflow/react",
    "@dagrejs/dagre",
  ].forEach(includeRuntime);
  const trusted = [...runtimeRoots.values()];
  const lucideRoot = dirname(require.resolve("lucide-react/package.json"));
  type RuntimePackage = {
    manifest: ComponentManifest;
    files: Map<string, Buffer>;
    validator: string;
    children: Map<string, string>;
  };
  const packages = new Map<string, RuntimePackage>();
  const rootPackage: RuntimePackage = {
    manifest,
    files,
    validator,
    children: new Map(),
  };
  packages.set("root", rootPackage);
  const loadDependencies = async (
    owner: RuntimePackage,
    active: Set<string>,
    depth: number,
  ): Promise<void> => {
    if (depth > 16) throw new Error("Component composition exceeds 16 levels.");
    for (const ref of owner.manifest.dependencies ?? []) {
      const slot = `${ref.id}@${ref.version}`;
      if (active.has(slot))
        throw new Error(`Component composition cycle: ${slot}.`);
      const key = revisionIdentity(ref);
      owner.children.set(ref.id, key);
      if (packages.has(key)) {
        await loadDependencies(
          packages.get(key)!,
          new Set(active).add(slot),
          depth + 1,
        );
        continue;
      }
      if (packages.size >= 100)
        throw new Error("Component composition exceeds 100 packages.");
      const source = await readComponentSource(
        home,
        ref.id,
        ref.version,
        projectId,
        { integrity: ref.integrity },
      );
      const child: RuntimePackage = {
        manifest: source.manifest,
        files: componentSourceFiles(source),
        validator: standaloneCode(ajv, ajv.compile(source.schema)),
        children: new Map(),
      };
      packages.set(key, child);
      await loadDependencies(child, new Set(active).add(slot), depth + 1);
    }
  };
  await loadDependencies(
    rootPackage,
    new Set([`${manifest.id}@${manifest.version}`]),
    0,
  );
  // Every local import stays within its own verified package, including nested packages.
  const locate = (
    map: Map<string, Buffer> | Record<string, string>,
    candidate: string,
  ) => {
    const has = (path: string) =>
      map instanceof Map ? map.has(path) : Object.hasOwn(map, path);
    return [
      candidate,
      ...[
        ".tsx",
        ".ts",
        ".jsx",
        ".js",
        ".json",
        "/index.tsx",
        "/index.ts",
        "/index.jsx",
        "/index.js",
      ].map((ext) => candidate + ext),
    ].find(has);
  };
  const modulePath = (key: string, file: string) => `${key}/${file}`;
  const splitModule = (path: string) => {
    const slash = path.indexOf("/");
    return { key: path.slice(0, slash), file: path.slice(slash + 1) };
  };
  const boundary: Plugin = {
    name: "showai-component-boundary",
    setup(plugin) {
      plugin.onResolve({ filter: /^showai:/ }, (args) => {
        const owner =
          args.namespace === "showai-package"
            ? splitModule(args.importer).key
            : args.namespace === "showai-nested"
              ? args.importer
              : "root";
        if (args.path === "showai:validator")
          return { path: owner, namespace: "showai-validator" };
        if (args.path === "showai:components")
          return { path: "sdk.tsx", namespace: "showai-builtin" };
        if (args.path.startsWith("showai:component/")) {
          const id = args.path.slice("showai:component/".length);
          const child = packages.get(owner)?.children.get(id);
          return child
            ? {
                path: child,
                namespace: "showai-nested",
              }
            : {
                errors: [
                  {
                    text: `Declare an exact manifest.dependencies reference before importing ${id}.`,
                  },
                ],
              };
        }
        return { errors: [{ text: "Unknown ShowAI component module." }] };
      });
      plugin.onLoad(
        { filter: /.*/, namespace: "showai-validator" },
        (args) => ({
          contents: packages.get(args.path)!.validator,
          loader: "js",
        }),
      );
      plugin.onLoad({ filter: /.*/, namespace: "showai-builtin" }, (args) => ({
        contents: builtinSources[args.path],
        loader: args.path.endsWith(".mjs")
          ? "js"
          : (extname(args.path).slice(1) as "tsx" | "ts" | "css"),
      }));
      plugin.onLoad({ filter: /.*/, namespace: "showai-nested" }, (args) => {
        const owner = packages.get(args.path)!;
        return {
          contents: `import React from 'react';import Child from './${owner.manifest.entry.replace(/^\.\//, "")}';import validate from 'showai:validator';
const defaults=${JSON.stringify(owner.manifest.defaultData)};
function check(data){if(!validate(data))throw new Error(${JSON.stringify(owner.manifest.id)}+' props: '+JSON.stringify(validate.errors));return data;}
export default function Nested({data=defaults,onChange,readOnly=true}){check(data);return <Child data={data} readOnly={readOnly} onChange={readOnly||!onChange?undefined:next=>onChange(check(next))}/>;}`,
          loader: "tsx",
        };
      });
      plugin.onLoad({ filter: /.*/, namespace: "showai-package" }, (args) => {
        const { key, file } = splitModule(args.path),
          owner = packages.get(key)!;
        const contents = owner.files.get(file);
        if (!contents)
          return { errors: [{ text: `Missing package file: ${file}` }] };
        const extension = extname(file).slice(1);
        return {
          contents,
          loader: ["tsx", "ts", "jsx", "js", "json", "css"].includes(extension)
            ? (extension as "tsx" | "ts" | "jsx" | "js" | "json" | "css")
            : "dataurl",
        };
      });
      plugin.onResolve({ filter: /.*/ }, (args) => {
        if (args.path.startsWith("showai:")) return;
        if (
          args.namespace === "showai-validator" &&
          args.path.startsWith("ajv/")
        )
          return { path: require.resolve(args.path) };
        const sdkImport = args.namespace === "showai-builtin";
        if (
          [
            "react",
            "react/jsx-runtime",
            "react/jsx-dev-runtime",
            "react-dom/client",
          ].includes(args.path) ||
          (sdkImport &&
            [
              "react-dom",
              "marked",
              "lucide-react",
              "@xyflow/react",
              "@xyflow/react/dist/style.css",
              "@dagrejs/dagre",
            ].includes(args.path))
        ) {
          return {
            path:
              args.path === "lucide-react"
                ? join(
                    dirname(require.resolve("lucide-react/package.json")),
                    require("lucide-react/package.json").module,
                  )
                : require.resolve(args.path),
            ...(args.path === "lucide-react" ? { sideEffects: false } : {}),
          };
        }
        if (trusted.some((base) => inside(base, args.importer))) {
          if (
            !args.path.startsWith(".") &&
            [...runtimeRoots.keys()].some(
              (name) => args.path === name || args.path.startsWith(name + "/"),
            )
          ) {
            const target = require.resolve(args.path);
            if (trusted.some((base) => inside(base, target)))
              return { path: target };
          }
          if (args.path.startsWith(".")) {
            const resolved = require.resolve(
              resolve(args.resolveDir, args.path),
            );
            if (trusted.some((base) => inside(base, resolved)))
              return {
                path: resolved,
                ...(inside(lucideRoot, resolved) ? { sideEffects: false } : {}),
              };
          }
          return {
            errors: [{ text: `Unexpected runtime dependency: ${args.path}` }],
          };
        }
        if (!args.path.startsWith("."))
          return {
            errors: [
              {
                text: `Only React, ShowAI SDK and package-local imports are allowed: ${args.path}`,
              },
            ],
          };
        const { key, file } =
          args.namespace === "showai-package"
            ? splitModule(args.importer)
            : args.namespace === "showai-nested"
              ? { key: args.importer, file: "" }
              : { key: "root", file: "" };
        const base = sdkImport ? "/builtin" : "/package";
        const candidate = relative(
          base,
          resolve(base, dirname(sdkImport ? args.importer : file), args.path),
        )
          .split(sep)
          .join("/");
        if (candidate.startsWith("../") || candidate === "..")
          return {
            errors: [{ text: "Component imports cannot leave the package." }],
          };
        const selected = locate(
          sdkImport ? builtinSources : packages.get(key)!.files,
          candidate,
        );
        return selected
          ? {
              path: sdkImport ? selected : modulePath(key, selected),
              namespace: sdkImport ? "showai-builtin" : "showai-package",
              ...(sdkImport ? { sideEffects: selected.endsWith(".css") } : {}),
            }
          : { errors: [{ text: `Missing package file: ${args.path}` }] };
      });
    },
  };
  const output = await build({
    stdin: {
      contents: runtimeSource(`./${manifest.entry.replace(/^\.\//, "")}`),
      resolveDir: root,
      sourcefile: "showai-entry.tsx",
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    outfile: "component.js",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [boundary],
    logLevel: "silent",
    legalComments: "none",
  });
  const script = output.outputFiles.find((file) =>
    file.path.endsWith(".js"),
  )?.text;
  if (!script)
    throw new Error("The component compiler did not produce JavaScript.");
  const css = output.outputFiles
    .filter((file) => file.path.endsWith(".css"))
    .map((file) => file.text)
    .join("\n");
  // The conversation already provides the security sandbox and forbids nested
  // frames. Reuse its reader's React instead of embedding React twice per package.
  const inlineReact: Plugin = {
    name: "showai-inline-react",
    setup(plugin) {
      plugin.onResolve(
        {
          filter:
            /^(?:react(?:\/jsx(?:-dev)?-runtime)?|react-dom(?:\/client)?)$/,
        },
        (args) => ({ path: args.path, namespace: "showai-inline-react" }),
      );
      plugin.onLoad(
        { filter: /.*/, namespace: "showai-inline-react" },
        (args) => {
          const namespace = {
            react: "react",
            "react-dom/client": "client",
            "react-dom": "dom",
            "react/jsx-runtime": "jsx",
            "react/jsx-dev-runtime": "jsxDev",
          }[args.path];
          const names = Object.keys(require(args.path)).filter(
            (name) => name !== "default" && /^[$A-Z_a-z][$\w]*$/.test(name),
          );
          return {
            contents: `const runtime=globalThis.__SHOWAI_COMPONENT_HOST__.${namespace};export default runtime;${names.map((name) => `export const ${name}=runtime.${name};`).join("")}`,
            loader: "js",
          };
        },
      );
    },
  };
  const inlineOutput = await build({
    stdin: {
      contents: inlineRuntimeSource(`./${manifest.entry.replace(/^\.\//, "")}`),
      resolveDir: root,
      sourcefile: "showai-inline-entry.tsx",
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "ShowAIInlineComponent",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    outfile: "inline.js",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [inlineReact, boundary],
    logLevel: "silent",
    legalComments: "none",
  });
  const inline = {
    script: inlineOutput.outputFiles.find((file) => file.path.endsWith(".js"))!
      .text,
    styles: inlineOutput.outputFiles
      .filter((file) => file.path.endsWith(".css"))
      .map((file) => file.text)
      .join("\n"),
  };
  if (
    Buffer.byteLength(inline.script) + Buffer.byteLength(inline.styles) >
    MAX_HTML_BYTES
  )
    throw new Error("Compiled inline component exceeds 2 MB.");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;padding:0;font:14px/1.6 system-ui,sans-serif;color:#292d29}*{box-sizing:border-box}button,input,select,textarea{font:inherit}#component-root{display:flow-root;overflow-wrap:anywhere}${css.replace(/<\/style/gi, "<\\/style")}</style></head><body><div id="component-root"></div>${COMPONENT_DATA_MARKER}<script>${script.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
  if (Buffer.byteLength(html) > MAX_HTML_BYTES)
    throw new Error("Compiled component exceeds 2 MB.");
  const component: CompiledComponent = {
    ...manifest,
    schema,
    html,
    inline,
    scope,
    updatedAt: new Date().toISOString(),
    integrity: "",
  };
  component.integrity = compiledIntegrity(component);
  return component;
}

interface StoredComponent extends CompiledComponent {
  sourceIntegrity: string;
}
function compiledRecord(value: unknown, scope: CatalogScope): StoredComponent {
  const item = record(value, "Compiled component");
  const manifest = manifestFrom(item);
  if (
    typeof item.html !== "string" ||
    Buffer.byteLength(item.html) > MAX_HTML_BYTES ||
    !item.html.includes(COMPONENT_DATA_MARKER) ||
    typeof item.updatedAt !== "string" ||
    typeof item.sourceIntegrity !== "string"
  )
    throw new Error("Invalid compiled component file.");
  const result = {
    ...manifest,
    html: item.html,
    schema: item.schema as JsonSchema,
    ...(item.inline
      ? { inline: item.inline as CompiledComponent["inline"] }
      : {}),
    updatedAt: item.updatedAt,
    integrity: String(item.integrity),
    sourceIntegrity: item.sourceIntegrity,
    scope,
  };
  if (
    result.inline &&
    (typeof result.inline.script !== "string" ||
      typeof result.inline.styles !== "string" ||
      Buffer.byteLength(result.inline.script) +
        Buffer.byteLength(result.inline.styles) >
        MAX_HTML_BYTES)
  )
    throw new Error("Invalid inline component runtime.");
  if (compiledIntegrity(result) !== result.integrity)
    throw new Error("Compiled component integrity verification failed.");
  return result;
}
export async function listComponents(
  home: string,
  projectId?: string,
  options: CatalogReadOptions = {},
): Promise<ComponentMetadata[]> {
  const result: ComponentMetadata[] = [];
  for (const location of locations(home, "components", projectId, options)) {
    for (const id of (await children(home, location.path))
      .filter((id) => COMPONENT_ID.test(id))
      .sort()) {
      for (const version of (await children(home, join(location.path, id)))
        .filter((version) => COMPONENT_VERSION.test(version))
        .sort((a, b) => compareVersion(b, a))) {
        const {
          html: _html,
          inline: _inline,
          schema: _schema,
          sourceIntegrity: _source,
          ...metadata
        } = compiledRecord(
          await readJson(
            home,
            join(location.path, id, version, "compiled.json"),
          ),
          location.scope,
        );
        if (metadata.id !== id || metadata.version !== version)
          throw new Error("Component path and identity differ.");
        result.push(metadata);
      }
    }
  }
  return result;
}
async function componentLocation(
  home: string,
  id: string,
  version?: string,
  projectId?: string,
  options: CatalogReadOptions = {},
): Promise<{ path: string; scope: CatalogScope }> {
  assertId(id);
  if (version) assertVersion(version);
  for (const location of locations(home, "components", projectId, options)) {
    const base = await safePath(home, join(location.path, id));
    if (!(await optionalStat(base))) continue;
    const versions = version
      ? [version]
      : (await children(home, base))
          .filter((value) => COMPONENT_VERSION.test(value))
          .sort((a, b) => compareVersion(b, a));
    for (const selected of versions) {
      const path = await safePath(home, join(base, selected));
      if (!(await optionalStat(path))) continue;
      const item = compiledRecord(
        await readJson(home, join(path, "compiled.json")),
        location.scope,
      );
      if (item.id !== id || item.version !== selected)
        throw new Error("Component path and identity differ.");
      if (!options.integrity || options.integrity === item.integrity)
        return { path, scope: location.scope };
    }
  }
  throw new Error(
    `Exact component not found: ${id}${version ? `@${version}` : ""}${options.integrity ? ` (integrity ${options.integrity})` : ""}.`,
  );
}
export async function getComponent(
  home: string,
  id: string,
  version?: string,
  projectId?: string,
  options: CatalogReadOptions = {},
): Promise<CompiledComponent> {
  const location = await componentLocation(
    home,
    id,
    version,
    projectId,
    options,
  );
  const { sourceIntegrity: _source, ...component } = compiledRecord(
    await readJson(home, join(location.path, "compiled.json")),
    location.scope,
  );
  return component;
}
export async function getComponentByRef(
  home: string,
  input: PackageRevisionRef,
  projectId?: string,
): Promise<CompiledComponent> {
  const ref = checkedRef(input, "component");
  return getComponent(home, ref.id, ref.version, ref.projectId ?? projectId, {
    scope: ref.scope,
    integrity: ref.integrity,
  });
}
export async function importComponent(
  home: string,
  packageDirectory: string,
  projectId?: string,
): Promise<CompiledComponent> {
  projectId = await requireProjectWrite(home, projectId);
  const directory = await realpath(packageDirectory);
  const files = await packageFiles(directory);
  if (!files.has("manifest.json") || !files.has("props.schema.json"))
    throw new Error(
      "Component package needs manifest.json and props.schema.json.",
    );
  const manifest = manifestFrom(
    JSON.parse(files.get("manifest.json")!.toString("utf8")),
  );
  const schema = JSON.parse(
    files.get("props.schema.json")!.toString("utf8"),
  ) as JsonSchema;
  const sourceIntegrity = sourceDigest(files);
  const destination = await safePath(
    home,
    join(
      packageBase(home, "components", projectId),
      manifest.id,
      manifest.version,
    ),
    true,
  );
  const scope: CatalogScope = "project";
  if (await optionalStat(destination)) {
    const existing = compiledRecord(
      await readJson(home, join(destination, "compiled.json")),
      scope,
    );
    if (existing.sourceIntegrity === sourceIntegrity)
      return getComponent(home, manifest.id, manifest.version, projectId);
    if (existing.sourceIntegrity !== "portable")
      throw new Error(
        `Component ${manifest.id}@${manifest.version} is immutable. Increase its version before changing the package.`,
      );
    const compiled = await compilePackage(
      directory,
      manifest,
      schema,
      files,
      scope,
      home,
      projectId,
    );
    if (compiled.integrity !== existing.integrity)
      throw new Error(
        `Component ${manifest.id}@${manifest.version} is immutable. Increase its version before changing the package.`,
      );
    // Restoring source does not rewrite an immutable portable revision. Keep
    // verified source in a separate content-addressed cache beside versions.
    const cache = await safePath(
      home,
      join(dirname(destination), ".sources", existing.integrity),
      true,
    );
    if (await optionalStat(cache)) {
      if (sourceDigest(await packageFiles(cache)) !== sourceIntegrity)
        throw new Error(
          "Verified component source is immutable. Save a new version.",
        );
      return compiled;
    }
    const stagedSource = join(dirname(cache), `.source-${randomUUID()}`);
    await mkdir(stagedSource);
    try {
      for (const [path, contents] of files) {
        const target = join(stagedSource, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, contents, { flag: "wx", mode: 0o600 });
      }
      await writeFile(
        join(stagedSource, ".source-integrity.json"),
        JSON.stringify({ sourceIntegrity }),
        { flag: "wx", mode: 0o600 },
      );
      await rename(stagedSource, cache);
    } finally {
      await rm(stagedSource, { recursive: true, force: true });
    }
    return compiled;
  }
  const component = await compilePackage(
    directory,
    manifest,
    schema,
    files,
    scope,
    home,
    projectId,
  );
  const staging = join(dirname(destination), `.import-${randomUUID()}`);
  await mkdir(staging);
  try {
    for (const [path, contents] of files) {
      const target = join(staging, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents, { flag: "wx", mode: 0o600 });
    }
    await writeFile(
      join(staging, "compiled.json"),
      JSON.stringify({ ...component, sourceIntegrity }, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await rename(staging, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return component;
}
async function componentSourcePath(
  home: string,
  location: { path: string; scope: CatalogScope },
): Promise<string | undefined> {
  if (
    await optionalStat(
      await safePath(home, join(location.path, "manifest.json")),
    )
  )
    return location.path;
  const component = compiledRecord(
    await readJson(home, join(location.path, "compiled.json")),
    location.scope,
  );
  const cache = await safePath(
    home,
    join(dirname(location.path), ".sources", component.integrity),
  );
  return (await optionalStat(cache)) ? cache : undefined;
}
export async function readComponentSource(
  home: string,
  id: string,
  version?: string,
  projectId?: string,
  options: CatalogReadOptions = {},
): Promise<ComponentSource> {
  const location = await componentLocation(
    home,
    id,
    version,
    projectId,
    options,
  );
  await safePath(home, location.path);
  const sourcePath = await componentSourcePath(home, location);
  const files = sourcePath
    ? await packageFiles(sourcePath)
    : new Map<string, Buffer>();
  if (!files.has("manifest.json") || !files.has("props.schema.json"))
    throw new Error(
      "This component was imported from a portable page and has no editable source. Import the original source package to edit it.",
    );
  const compiled = compiledRecord(
    await readJson(home, join(location.path, "compiled.json")),
    location.scope,
  );
  const expectedSource =
    sourcePath === location.path
      ? compiled.sourceIntegrity
      : (
          (await readJson(
            home,
            join(sourcePath!, ".source-integrity.json"),
          )) as { sourceIntegrity: string }
        ).sourceIntegrity;
  if (expectedSource !== "portable" && sourceDigest(files) !== expectedSource)
    throw new Error(
      "Component source integrity verification failed. Restore the original source or save a new version.",
    );
  const manifest = manifestFrom(
    JSON.parse(files.get("manifest.json")!.toString("utf8")),
  );
  return {
    manifest,
    ...(manifest.parents ? { parents: manifest.parents } : {}),
    ...(manifest.mergeBase ? { mergeBase: manifest.mergeBase } : {}),
    schema: JSON.parse(files.get("props.schema.json")!.toString("utf8")),
    source: files.get(manifest.entry.replace(/^\.\//, ""))!.toString("utf8"),
    files: Object.fromEntries(
      [...files]
        .filter(([path]) => TEXT_EXTENSIONS.has(extname(path)))
        .map(([path, contents]) => [path, contents.toString("utf8")]),
    ),
    assets: Object.fromEntries(
      [...files]
        .filter(([path]) => !TEXT_EXTENSIONS.has(extname(path)))
        .map(([path, contents]) => [path, contents.toString("base64")]),
    ),
  };
}
export async function saveComponent(
  home: string,
  input: {
    manifest: ComponentManifest;
    schema: JsonSchema;
    source: string;
    files?: Record<string, string>;
    assets?: Record<string, string>;
    parents?: PackageRevisionRef[];
    mergeBase?: PackageRevisionRef;
  },
  projectId?: string,
): Promise<CompiledComponent> {
  projectId = await requireProjectWrite(home, projectId);
  const manifest = manifestFrom({
    ...input.manifest,
    ...(input.parents ? { parents: input.parents } : {}),
    ...(input.mergeBase ? { mergeBase: input.mergeBase } : {}),
  });
  if (typeof input.source !== "string")
    throw new Error("Component source must be text.");
  const directory = await safePath(
    home,
    join(resolve(home), "tmp", `component-${randomUUID()}`),
    true,
  );
  await mkdir(directory);
  try {
    const files = {
      ...(input.files ?? {}),
      "manifest.json": JSON.stringify(manifest, null, 2),
      "props.schema.json": JSON.stringify(input.schema, null, 2),
      [manifest.entry]: input.source,
    };
    for (const [path, source] of Object.entries(files)) {
      if (
        isAbsolute(path) ||
        path.includes("\\") ||
        path.split("/").includes("..") ||
        !inside(directory, resolve(directory, path)) ||
        !TEXT_EXTENSIONS.has(extname(path)) ||
        typeof source !== "string"
      )
        throw new Error(
          "Component source files must stay inside the package and use supported text extensions.",
        );
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source, { flag: "wx", mode: 0o600 });
    }
    for (const [path, encoded] of Object.entries(input.assets ?? {})) {
      if (
        isAbsolute(path) ||
        path.includes("\\") ||
        path.split("/").includes("..") ||
        !inside(directory, resolve(directory, path)) ||
        !SOURCE_EXTENSIONS.has(extname(path)) ||
        TEXT_EXTENSIONS.has(extname(path)) ||
        typeof encoded !== "string" ||
        !/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded) ||
        encoded.length > MAX_PACKAGE_BYTES * 1.4
      )
        throw new Error(
          "Component assets must be supported package-local files encoded as base64.",
        );
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(encoded, "base64"), {
        flag: "wx",
        mode: 0o600,
      });
    }
    return await importComponent(home, directory, projectId);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export async function resolveDocumentComponents(
  home: string,
  document: ShowDocument,
  projectId?: string,
): Promise<CompiledComponent[]> {
  return Promise.all(
    collectCustomComponentRefs(document).map(async (ref) => {
      const component = await getComponent(
        home,
        ref.componentId,
        ref.version,
        projectId,
        { integrity: ref.integrity, scope: ref.scope },
      );
      if (ref.integrity && component.integrity !== ref.integrity)
        throw new Error(
          `Component integrity mismatch: ${ref.componentId}@${ref.version}.`,
        );
      const visit = (node: typeof document.content) => {
        if (
          node.type === "widget" &&
          node.attrs?.kind === "custom" &&
          node.attrs.data?.componentId === component.id &&
          node.attrs.data?.version === component.version &&
          (node.attrs.data?.integrity
            ? node.attrs.data.integrity === component.integrity
            : !ref.integrity && node.attrs.data?.scope === ref.scope)
        )
          assertProps(component.schema, node.attrs.data.props);
        node.content?.forEach(visit);
      };
      visit(document.content);
      return component;
    }),
  );
}

/** Installs serialized sandbox runtimes without ever evaluating or executing their code. */
export async function importCompiledComponents(
  home: string,
  components: CompiledComponent[],
  projectId?: string,
): Promise<ComponentMetadata[]> {
  projectId = await requireProjectWrite(home, projectId);
  if (!Array.isArray(components) || components.length > 100)
    throw new Error("Invalid portable component collection.");
  const scope: CatalogScope = "project";
  const checked = components.map((component) => {
    const validated = compiledRecord(
      { ...component, sourceIntegrity: "portable" },
      scope,
    );
    assertProps(validated.schema, validated.defaultData);
    validated.examples.forEach((example) =>
      assertProps(validated.schema, example.data),
    );
    return validated;
  });
  const keys = new Map<string, string>();
  for (const component of checked) {
    const key = `${component.id}@${component.version}`;
    if (keys.has(key) && keys.get(key) !== component.integrity)
      throw new Error(`Conflicting portable component: ${key}.`);
    keys.set(key, component.integrity);
    const path = await safePath(
      home,
      join(
        packageBase(home, "components", projectId),
        component.id,
        component.version,
      ),
    );
    if (await optionalStat(path)) {
      const existing = compiledRecord(
        await readJson(home, join(path, "compiled.json")),
        scope,
      );
      if (existing.integrity !== component.integrity)
        throw new Error(
          `Component ${key} is immutable. Its installed content differs from this page.`,
        );
    }
  }
  const imported: ComponentMetadata[] = [];
  for (const component of checked) {
    const path = await safePath(
      home,
      join(
        packageBase(home, "components", projectId),
        component.id,
        component.version,
      ),
      true,
    );
    if (!(await optionalStat(path))) {
      const staging = join(dirname(path), `.portable-${randomUUID()}`);
      await mkdir(staging);
      try {
        await writeFile(
          join(staging, "compiled.json"),
          JSON.stringify(component, null, 2) + "\n",
          { flag: "wx", mode: 0o600 },
        );
        await rename(staging, path);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    }
    const {
      html: _html,
      inline: _inline,
      schema: _schema,
      sourceIntegrity: _source,
      ...metadata
    } = component;
    imported.push(metadata);
  }
  return imported;
}
export function componentWidgetData(
  component: CompiledComponent,
  props: Record<string, unknown> = component.defaultData,
): Record<string, unknown> {
  assertProps(component.schema, props);
  return browserComponentWidgetData(component, props);
}
export function blankDocument(): ShowDocument {
  const date = new Date().toISOString();
  return {
    id: randomUUID(),
    title: "",
    icon: "",
    cover: "none",
    parentId: null,
    favorite: false,
    archived: false,
    createdAt: date,
    updatedAt: date,
    comments: [],
    content: structuredClone(emptyContent),
  };
}

/** Freeze authoring references without mutating a caller's live editor draft. */
export async function lockDocumentComponents(
  home: string,
  document: ShowDocument,
  projectId?: string,
): Promise<ShowDocument> {
  const copy = documentCopy(document);
  const selected = new Map<string, Promise<CompiledComponent>>();
  const visit = async (node: ShowDocument["content"]): Promise<void> => {
    if (node.type === "widget" && node.attrs?.kind === "custom") {
      const data = node.attrs.data as Record<string, unknown>;
      const ref = collectCustomComponentRefs({
        ...copy,
        content: { type: "doc", content: [node] },
      })[0];
      const key = `${ref.componentId}@${ref.version}:${ref.integrity ?? ""}:${ref.scope ?? ""}`;
      let pending = selected.get(key);
      if (!pending) {
        pending = getComponent(home, ref.componentId, ref.version, projectId, {
          integrity: ref.integrity,
          scope: ref.scope,
        });
        selected.set(key, pending);
      }
      const component = await pending;
      assertProps(component.schema, data.props);
      const { scope: _scope, ...properties } = data;
      node.attrs.data = {
        ...properties,
        componentId: component.id,
        version: component.version,
        integrity: component.integrity,
      };
    }
    await Promise.all((node.content ?? []).map(visit));
  };
  await visit(copy.content);
  return copy;
}

export async function instantiateTemplateRecord(
  home: string,
  input: PackageRevisionRef | TemplateRecord,
  projectId?: string,
): Promise<ShowDocument> {
  const initial =
    "document" in input
      ? templateRecord(input, input.scope)
      : await getTemplateByRef(home, input, projectId);
  let expandedNodes = 0;
  const expand = async (
    template: TemplateRecord,
    ancestors: Set<string>,
    depth: number,
  ): Promise<ShowDocument> => {
    const identity = revisionIdentity(packageRevisionRef("template", template));
    if (ancestors.has(identity))
      throw new Error(
        `Template composition cycle: ${template.id}@${template.version}.`,
      );
    if (depth > 16) throw new Error("Template composition exceeds 16 levels.");
    const active = new Set(ancestors).add(identity);
    const documents: ShowDocument[] = [];
    const count = (node: ShowDocument["content"]) => {
      if (++expandedNodes > 12000)
        throw new Error("Expanded template exceeds 12000 nodes.");
      node.content?.forEach(count);
    };
    if (!template.composition) {
      count(template.document.content);
      return structuredClone(template.document);
    }
    for (const part of template.composition) {
      if (part.type === "content") {
        const fragment = {
          ...blankDocument(),
          content: ["doc", "surface"].includes(part.content.type ?? "")
            ? structuredClone(part.content)
            : { type: "doc", content: [structuredClone(part.content)] },
          ...(part.layout ? { layout: part.layout } : {}),
          ...(part.views ? { views: part.views } : {}),
        };
        count(fragment.content);
        documents.push(fragment);
      } else {
        if (part.title)
          documents.push({
            ...blankDocument(),
            content: {
              type: "doc",
              content: [
                {
                  type: "heading",
                  attrs: { level: 2 },
                  content: [{ type: "text", text: part.title }],
                },
              ],
            },
          });
        documents.push(
          await expand(
            await getTemplateByRef(home, part.ref, projectId),
            active,
            depth + 1,
          ),
        );
      }
    }
    if (!documents.some(isSurface))
      return {
        ...template.document,
        content: {
          type: "doc",
          content: documents.flatMap((item) => item.content.content ?? []),
        },
      };
    const combined = upgradeDocument({
      ...template.document,
      content: { type: "doc", content: [] },
      title: "",
    });
    combined.title = template.document.title;
    let offset = 0;
    for (const source of documents) {
      const part = remapSurfaceIds(upgradeDocument(source), randomUUID);
      const roots = part.content.content ?? [];
      const minX = Math.min(
        0,
        ...roots.map((node) => part.layout![node.attrs!.id].x),
      );
      let edge = offset;
      for (const node of roots) {
        const frame = part.layout![node.attrs!.id];
        frame.x += offset - minX;
        edge = Math.max(edge, frame.x + frame.width);
      }
      combined.content.content!.push(...roots);
      Object.assign(combined.layout!, part.layout);
      combined.views!.saved.push(...part.views!.saved);
      combined.views!.initial ??= part.views!.initial;
      combined.views!.readingOrder.push(...part.views!.readingOrder);
      offset = edge + 64;
    }
    return combined;
  };
  return instantiateTemplate(
    await lockDocumentComponents(
      home,
      await expand(initial, new Set(), 0),
      projectId,
    ),
  );
}

function templateDependencies(template: TemplateRecord): PackageRevisionRef[] {
  const refs = new Map<string, PackageRevisionRef>();
  const put = (ref: PackageRevisionRef) => {
    const identity = portableRef(ref);
    refs.set(revisionIdentity(identity), identity);
  };
  for (const dependency of template.dependencies) put(dependency);
  const collect = (content: ShowDocument["content"]) => {
    const doc = {
      ...template.document,
      content:
        content.type === "doc" ? content : { type: "doc", content: [content] },
    };
    for (const ref of collectCustomComponentRefs(doc)) {
      if (!ref.integrity)
        throw new Error(
          `Template ${template.id} has an unlocked component. Fork it to a versioned project template first.`,
        );
      put({
        kind: "component",
        id: ref.componentId,
        version: ref.version,
        integrity: ref.integrity,
      });
    }
  };
  if (template.composition)
    for (const part of template.composition) {
      if (part.type === "template") put(part.ref);
      else collect(part.content);
    }
  else collect(template.document.content);
  return [...refs.values()];
}

export async function resolvePackageBundle(
  home: string,
  input: PackageRevisionRef,
  projectId?: string,
): Promise<PackageBundle> {
  const root = checkedRef(input),
    components: PackageBundle["components"] = [],
    records: TemplateRecord[] = [];
  const visited = new Set<string>();
  const walk = async (
    ref: PackageRevisionRef,
    ancestors: Set<string>,
    depth: number,
  ): Promise<void> => {
    const key = revisionIdentity(ref);
    if (ancestors.has(key))
      throw new Error(`Package dependency cycle at ${ref.id}@${ref.version}.`);
    if (depth > 16 || visited.size > 1000)
      throw new Error("Package dependency closure is too large.");
    if (visited.has(key)) return;
    const active = new Set(ancestors).add(key);
    if (ref.kind === "component") {
      const component = await getComponentByRef(home, ref, projectId);
      const location = await componentLocation(
        home,
        component.id,
        component.version,
        ref.projectId ?? projectId,
        { scope: ref.scope, integrity: component.integrity },
      );
      const hasSource = await componentSourcePath(home, location);
      const source = hasSource
        ? await readComponentSource(
            home,
            component.id,
            component.version,
            ref.projectId ?? projectId,
            { scope: ref.scope, integrity: component.integrity },
          )
        : undefined;
      for (const dependency of component.dependencies ?? [])
        await walk(dependency, active, depth + 1);
      components.push({ component, ...(source ? { source } : {}) });
    } else {
      const template = await getTemplateByRef(home, ref, projectId);
      for (const dependency of templateDependencies(template))
        await walk(dependency, active, depth + 1);
      records.push(template);
    }
    visited.add(key);
  };
  await walk(root, new Set(), 0);
  return {
    format: "showai-catalog-bundle",
    version: 1,
    root: portableRef(root),
    components,
    templates: records,
  };
}

function componentSourceFiles(source: ComponentSource): Map<string, Buffer> {
  const manifest = manifestFrom(source.manifest);
  const files = new Map<string, Buffer>();
  const add = (path: string, data: Buffer) => {
    if (
      isAbsolute(path) ||
      path.includes("\\") ||
      path.split("/").includes("..") ||
      !SOURCE_EXTENSIONS.has(extname(path)) ||
      path === "compiled.json" ||
      path.split("/").some((part) => part.startsWith("."))
    )
      throw new Error(
        "Component source must use supported package-local paths.",
      );
    files.set(path, data);
  };
  for (const [path, text] of Object.entries(source.files ?? {})) {
    if (typeof text !== "string" || !TEXT_EXTENSIONS.has(extname(path)))
      throw new Error("Invalid component text file.");
    add(path, Buffer.from(text));
  }
  for (const [path, encoded] of Object.entries(source.assets ?? {})) {
    if (
      typeof encoded !== "string" ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
      TEXT_EXTENSIONS.has(extname(path))
    )
      throw new Error("Invalid component binary asset.");
    add(path, Buffer.from(encoded, "base64"));
  }
  if (typeof source.source !== "string")
    throw new Error("Component source must contain its entry text.");
  add("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
  add("props.schema.json", Buffer.from(JSON.stringify(source.schema, null, 2)));
  add(manifest.entry.replace(/^\.\//, ""), Buffer.from(source.source));
  if (
    files.size > MAX_FILES ||
    [...files.values()].reduce((total, value) => total + value.length, 0) >
      MAX_PACKAGE_BYTES
  )
    throw new Error("Component source package exceeds its size limit.");
  return files;
}

/** Semantic validation is separate from a publication transport's byte checksum. */
export function validatePackageBundle(value: unknown): PackageBundle {
  const bundle = record(value, "Catalog bundle");
  if (
    bundle.format !== "showai-catalog-bundle" ||
    bundle.version !== 1 ||
    !Array.isArray(bundle.components) ||
    !Array.isArray(bundle.templates) ||
    bundle.components.length + bundle.templates.length > 1000
  )
    throw new Error("Invalid catalog bundle envelope.");
  const root = checkedRef(bundle.root);
  const components: PackageBundle["components"] = bundle.components.map(
    (value) => {
      const entry = record(value, "Bundle component");
      const { sourceIntegrity: _source, ...component } = compiledRecord(
        {
          ...record(entry.component, "Compiled component"),
          sourceIntegrity: "portable",
        },
        "published",
      );
      assertProps(component.schema, component.defaultData);
      component.examples.forEach((example) =>
        assertProps(component.schema, example.data),
      );
      if (entry.source !== undefined) {
        const source = entry.source as ComponentSource;
        componentSourceFiles(source);
        if (
          canonicalJson(manifestFrom(source.manifest)) !==
            canonicalJson(manifestFrom(component)) ||
          canonicalJson(source.schema) !== canonicalJson(component.schema)
        )
          throw new Error(
            "Bundle source metadata differs from its compiled component.",
          );
        return { component, source: structuredClone(source) };
      }
      return { component };
    },
  );
  const records = bundle.templates.map((item) =>
    templateRecord(item, "published"),
  );
  const available = new Map<string, PackageRevisionRef>();
  const slots = new Map<string, string>();
  for (const ref of [
    ...components.map((entry) =>
      packageRevisionRef("component", entry.component),
    ),
    ...records.map((item) => packageRevisionRef("template", item)),
  ]) {
    const slot = `${ref.kind}:${ref.id}@${ref.version}`;
    if (slots.has(slot) && slots.get(slot) !== ref.integrity)
      throw new Error(`Conflicting package identities in bundle: ${slot}.`);
    slots.set(slot, ref.integrity);
    available.set(revisionIdentity(ref), ref);
  }
  if (!available.has(revisionIdentity(root)))
    throw new Error("Bundle root is missing or its integrity differs.");
  const byTemplate = new Map(
    records.map((item) => [
      revisionIdentity(packageRevisionRef("template", item)),
      item,
    ]),
  );
  const check = (
    template: TemplateRecord,
    active: Set<string>,
    depth: number,
  ) => {
    const key = revisionIdentity(packageRevisionRef("template", template));
    if (active.has(key) || depth > 16)
      throw new Error("Bundle template dependency cycle or excessive depth.");
    const path = new Set(active).add(key);
    for (const ref of templateDependencies(template)) {
      if (!available.has(revisionIdentity(ref)))
        throw new Error(
          `Missing exact bundle dependency: ${ref.id}@${ref.version}.`,
        );
      if (ref.kind === "template")
        check(byTemplate.get(revisionIdentity(ref))!, path, depth + 1);
    }
  };
  const byComponent = new Map(
    components.map((entry) => [
      revisionIdentity(packageRevisionRef("component", entry.component)),
      entry.component,
    ]),
  );
  const checkComponent = (
    component: CompiledComponent,
    active: Set<string>,
    depth: number,
  ) => {
    const key = revisionIdentity(packageRevisionRef("component", component));
    if (active.has(key) || depth > 16)
      throw new Error("Bundle component dependency cycle or excessive depth.");
    const path = new Set(active).add(key);
    for (const ref of component.dependencies ?? []) {
      const child = byComponent.get(revisionIdentity(ref));
      if (!child)
        throw new Error(
          `Missing exact bundle dependency: ${ref.id}@${ref.version}.`,
        );
      checkComponent(child, path, depth + 1);
    }
  };
  components.forEach((entry) => checkComponent(entry.component, new Set(), 0));
  records.forEach((item) => check(item, new Set(), 0));
  return {
    format: "showai-catalog-bundle",
    version: 1,
    root: portableRef(root),
    components,
    templates: records,
  };
}

async function installBundle(
  home: string,
  value: PackageBundle,
  scope: "global" | "published",
): Promise<PackageBundle> {
  const bundle = validatePackageBundle(value);
  const targets = [
    ...bundle.components.map((entry) => ({
      kind: "components" as const,
      id: entry.component.id,
      version: entry.component.version,
      integrity: entry.component.integrity,
    })),
    ...bundle.templates.map((entry) => ({
      kind: "templates" as const,
      id: entry.id,
      version: entry.version,
      integrity: entry.integrity,
    })),
  ];
  // Preflight every dependency before making any visible revision available.
  for (const target of targets) {
    const path = await safePath(
      home,
      join(
        packageBase(home, target.kind, undefined, scope),
        target.id,
        target.version,
      ),
    );
    if (!(await optionalStat(path))) continue;
    const current =
      target.kind === "components"
        ? compiledRecord(
            await readJson(home, join(path, "compiled.json")),
            scope,
          )
        : templateRecord(
            await readJson(home, join(path, "template.json")),
            scope,
          );
    if (current.integrity !== target.integrity)
      throw new Error(
        `Cannot install immutable ${target.id}@${target.version}: ${scope} contains different content.`,
      );
  }
  for (const entry of bundle.components) {
    const component = { ...entry.component, scope };
    const destination = await safePath(
      home,
      join(
        packageBase(home, "components", undefined, scope),
        component.id,
        component.version,
      ),
      true,
    );
    if (await optionalStat(destination)) continue;
    const staging = join(dirname(destination), `.install-${randomUUID()}`);
    await mkdir(staging);
    try {
      const files = entry.source
        ? componentSourceFiles(entry.source)
        : new Map<string, Buffer>();
      for (const [path, contents] of files) {
        const target = join(staging, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, contents, { flag: "wx", mode: 0o600 });
      }
      await writeFile(
        join(staging, "compiled.json"),
        JSON.stringify(
          {
            ...component,
            sourceIntegrity: entry.source ? sourceDigest(files) : "portable",
          },
          null,
          2,
        ),
        { flag: "wx", mode: 0o600 },
      );
      await rename(staging, destination);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  // resolvePackageBundle orders children before parents. The root becomes visible last.
  const pending = new Map(
    bundle.templates.map((item) => [
      revisionIdentity(packageRevisionRef("template", item)),
      item,
    ]),
  );
  const installed = new Set<string>();
  const installTemplate = async (item: TemplateRecord): Promise<void> => {
    const key = revisionIdentity(packageRevisionRef("template", item));
    if (installed.has(key)) return;
    for (const ref of templateDependencies(item))
      if (ref.kind === "template" && pending.has(revisionIdentity(ref)))
        await installTemplate(pending.get(revisionIdentity(ref))!);
    await writeTemplateRevision(home, item, scope);
    installed.add(key);
  };
  for (const item of bundle.templates) await installTemplate(item);
  return {
    ...bundle,
    root: { ...bundle.root, scope },
    components: bundle.components.map((entry) => ({
      ...entry,
      component: { ...entry.component, scope },
    })),
    templates: bundle.templates.map((item) => ({ ...item, scope })),
  };
}

export async function importPublishedBundle(
  home: string,
  bundle: PackageBundle,
): Promise<PackageBundle> {
  return installBundle(home, bundle, "published");
}
export async function promotePackage(
  home: string,
  ref: PackageRevisionRef,
  input: { projectId: string; target: "global" },
): Promise<PackageBundle> {
  await requireProjectWrite(home, input.projectId);
  if (input.target !== "global")
    throw new Error("Promotion must explicitly target global.");
  return installBundle(
    home,
    await resolvePackageBundle(home, ref, input.projectId),
    "global",
  );
}

export async function forkPackage(
  home: string,
  input: PackageRevisionRef,
  target: { projectId: string; id?: string; version: string; name?: string },
): Promise<CompiledComponent | TemplateRecord> {
  await requireProjectWrite(home, target.projectId);
  assertVersion(target.version);
  const ref = checkedRef(input);
  if ((target.id ?? ref.id) === ref.id && target.version === ref.version)
    throw new Error(
      "A fork must have a new exact version or a new logical id.",
    );
  if (ref.kind === "component") {
    const source = await readComponentSource(
      home,
      ref.id,
      ref.version,
      ref.projectId ?? target.projectId,
      { integrity: ref.integrity, scope: ref.scope },
    );
    const {
      mergeBase: _sourceMergeBase,
      parents: _sourceParents,
      manifest: sourceManifest,
      ...sourceFiles
    } = source;
    const {
      mergeBase: _manifestMergeBase,
      parents: _manifestParents,
      ...manifest
    } = sourceManifest;
    return saveComponent(
      home,
      {
        ...sourceFiles,
        manifest: {
          ...manifest,
          id: target.id ?? ref.id,
          version: target.version,
          ...(target.name ? { name: target.name } : {}),
        },
        parents: [ref],
      },
      target.projectId,
    );
  }
  const template = await getTemplateByRef(home, ref, target.projectId);
  const { mergeBase: _mergeBase, parents: _parents, ...content } = template;
  return saveTemplate(
    home,
    {
      ...content,
      id: target.id ?? ref.id,
      version: target.version,
      ...(target.name ? { name: target.name } : {}),
      parents: [ref],
      composition: template.composition,
    },
    target.projectId,
  );
}

async function editablePackage(
  home: string,
  ref: PackageRevisionRef,
  projectId: string,
): Promise<EditablePackage> {
  if (ref.kind === "component") {
    // Verify the locked runtime as well as loading the source. Never invent a base.
    await getComponentByRef(home, ref, projectId);
    const source = await readComponentSource(
      home,
      ref.id,
      ref.version,
      ref.projectId ?? projectId,
      { scope: ref.scope, integrity: ref.integrity },
    );
    const {
      parents: _parents,
      mergeBase: _mergeBase,
      ...manifest
    } = source.manifest;
    const files = { ...source.files };
    delete files[manifest.entry];
    delete files[manifest.entry.replace(/^\.\//, "")];
    delete files["manifest.json"];
    delete files["props.schema.json"];
    return {
      kind: "component",
      manifest,
      schema: source.schema,
      source: source.source,
      files,
      assets: source.assets ?? {},
    };
  }
  const {
    scope: _scope,
    integrity: _integrity,
    dependencies: _deps,
    updatedAt: _date,
    parents: _parents,
    mergeBase: _mergeBase,
    legacy: _legacy,
    ...template
  } = await getTemplateByRef(home, ref, projectId);
  const {
    id: _id,
    createdAt: _created,
    updatedAt: _updated,
    ...document
  } = template.document;
  return {
    kind: "template",
    template: {
      ...template,
      document: {
        ...document,
        id: "merge-document",
        createdAt: "2000-01-01T00:00:00.000Z",
        updatedAt: "2000-01-01T00:00:00.000Z",
      },
    },
  };
}
export async function previewPackageMerge(
  home: string,
  input: PackageMergeInput,
): Promise<PackageMergePreview> {
  await requireProjectWrite(home, input.projectId);
  const base = checkedRef(input.base),
    ours = checkedRef(input.ours),
    theirs = checkedRef(input.theirs);
  if (base.kind !== ours.kind || base.kind !== theirs.kind)
    throw new Error("Merge inputs must have the same package kind.");
  const values = await Promise.all(
    [base, ours, theirs].map((ref) =>
      editablePackage(home, ref, input.projectId),
    ),
  );
  const normalizeIdentity = (item: EditablePackage) => {
    const copy = structuredClone(item),
      fields = copy.kind === "component" ? copy.manifest : copy.template;
    fields.id = base.id;
    fields.version = base.version;
    return copy;
  };
  const result = mergeValues(
    ...(values.map(normalizeIdentity) as [
      EditablePackage,
      EditablePackage,
      EditablePackage,
    ]),
  );
  const merged = result.value as EditablePackage;
  const identity =
    merged.kind === "component" ? merged.manifest : merged.template;
  identity.id = ours.id;
  identity.version = ours.version;
  return {
    ...input,
    base,
    ours,
    theirs,
    kind: ours.kind,
    merged,
    conflicts: result.conflicts,
  };
}
export async function savePackageMerge(
  home: string,
  input: PackageMergeInput & {
    id?: string;
    version: string;
    resolved: EditablePackage;
  },
): Promise<CompiledComponent | TemplateRecord> {
  const preview = await previewPackageMerge(home, input);
  assertVersion(input.version);
  if (!input.resolved || input.resolved.kind !== preview.kind)
    throw new Error(
      "Provide the resolved editable package after reviewing merge conflicts.",
    );
  const id = input.id ?? input.ours.id;
  if (
    [input.base, input.ours, input.theirs].some(
      (ref) => ref.id === id && ref.version === input.version,
    )
  )
    throw new Error("Save the merge as a new immutable version.");
  const parents = [checkedRef(input.ours), checkedRef(input.theirs)];
  if (input.resolved.kind === "component")
    return saveComponent(
      home,
      {
        ...input.resolved,
        manifest: { ...input.resolved.manifest, id, version: input.version },
        parents,
        mergeBase: input.base,
      },
      input.projectId,
    );
  return saveTemplate(
    home,
    {
      ...input.resolved.template,
      id,
      version: input.version,
      parents,
      mergeBase: input.base,
    },
    input.projectId,
  );
}

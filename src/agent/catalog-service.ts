import { createHash } from "node:crypto";
import { CoreError } from "../core/model";
import { canonicalJson } from "../core/diff";
import {
  getTemplate,
  getComponent,
  listBuiltinComponents,
  describeBuiltinComponent,
  listComponents,
  listTemplates,
  readComponentSource,
  readBuiltinComponentSource,
} from "../core/catalog";
import {
  parseTemplateBundle,
  TEMPLATE_SCHEMA_VERSION,
} from "../portable/template-bundle.mjs";
import {
  componentParameterReference,
  parameterPath,
} from "../portable/component-parameters.mjs";
import {
  describeCommand,
  catalogQueryScore,
  catalogSearchText,
  compareCatalogVersions,
  catalogEntry,
  catalogPage,
  shellToken,
  summarizeCatalog,
  type CatalogKind,
  type CatalogView,
} from "./disclosure";
import {
  KIND_OPERATORS,
  OPERATORS,
  describeValueTypes,
} from "../datasets/value-types.mjs";
import type {
  BuiltinComponentMetadata,
  CatalogScope,
  ComponentListing,
  SaveTemplateInput,
  TemplateRecord,
} from "../components/custom/types";
import { availableImporters } from "../core/importers/registry";
/** Column settings each built-in field type takes, for Agents writing columns. */
const DATABASE_FIELD_SETTINGS: Record<string, string> = {
  select:
    "options: [text], colors?: {option: tone} (gray, brown, orange, yellow, green, blue, purple, pink, red)",
  multiSelect:
    "options: [text], colors?: {option: tone}; cell value is a list of options",
  page: "folder?: folder id, titleColumn?: text column id; value showai://project/P/page/G",
  relation:
    "relation: {dataset: DATASET_ID, reverse?: {name}}; value is a list of record ids of that dataset ({columns, rows}); reverse shows the links on blocks bound to the target dataset",
  formula:
    'formula: {expression, kind?: text|number|date|boolean|list}; JavaScript expression over prop("Column name or id"), run per record in the transform sandbox; errors and cycles show per cell',
  rollup:
    "rollup: {relation: relation column id, column?: column id of the related records, aggregate: count|sum|average|min|max|unique|percentChecked}",
  date: "value YYYY-MM-DD or empty",
};
export interface CatalogSelection {
  projectId?: string;
  kind?: CatalogKind;
  scope?: CatalogScope | "all";
  version?: string;
  integrity?: string;
  view?: CatalogView;
  file?: string;
  parameterPath?: string;
  parameterOffset?: number;
  parameterLimit?: number;
  knownHash?: string;
}
/** Shared catalog semantics. Storage access is provided by the host catalog adapter. */
export class CatalogService {
  constructor(
    readonly store: { root: string },
    readonly projectId?: string,
  ) {}
  requireProject(projectId?: string): string {
    if (!projectId)
      throw new CoreError(
        "INVALID_DATA",
        "A resolved projectId is required. Call project_resolve or projects_list and pass projectId (CLI: projects current or --project).",
      );
    if (this.projectId && projectId !== this.projectId)
      throw new CoreError(
        "INVALID_PATH",
        `This connection is bound to project ${this.projectId}.`,
      );
    return projectId;
  }

  protected catalogProject(projectId?: string) {
    const selected = projectId ?? this.projectId;
    return selected ? this.requireProject(selected) : undefined;
  }

  async catalogList(
    input: {
      projectId?: string;
      kind?: CatalogKind;
      scope?: CatalogScope | "all";
      query?: string;
      limit?: number;
      cursor?: string;
      versions?: "recommended" | "all";
    } = {},
  ) {
    const projectId = this.catalogProject(input.projectId);
    if (input.versions && !["recommended", "all"].includes(input.versions))
      throw new CoreError(
        "INVALID_DATA",
        "versions must be recommended or all.",
      );
    const scope = input.scope ?? "all";
    const componentScope = input.scope ?? (projectId ? "project" : "builtin");
    const query = input.query?.trim().toLocaleLowerCase();
    const score = (item: object) =>
      query ? catalogQueryScore(catalogSearchText(item), query) : 1;
    const identity = (item: {
      kind: CatalogKind;
      scope: CatalogScope;
      id: string;
      version?: string;
      integrity?: string;
    }) =>
      `${item.kind}:${item.scope}:${item.id}:${item.version ?? ""}:${item.integrity ?? ""}`;
    const matching = new Map<string, number>();
    const documentationRevisions = new Map<string, string>();
    const summarize = (kind: CatalogKind, item: object) => {
      const summary = summarizeCatalog(kind, item, projectId);
      const matched = score(item);
      if (matched) matching.set(identity(summary), matched);
      documentationRevisions.set(
        identity(summary),
        createHash("sha256")
          .update(
            JSON.stringify(
              (item as { documentation?: unknown }).documentation ?? null,
            ),
          )
          .digest("hex"),
      );
      return summary;
    };
    const builtin =
      input.kind === "template" || !["all", "builtin"].includes(scope)
        ? []
        : listBuiltinComponents().map((item) => summarize("component", item));
    const components =
      input.kind === "template"
        ? []
        : (
            await listComponents(this.store.root, projectId, {
              scope: componentScope,
            })
          ).map((item) => summarize("component", item));
    const templates =
      input.kind === "component"
        ? []
        : (await listTemplates(this.store.root, projectId, { scope })).map(
            (item) => summarize("template", item),
          );
    const all = [
      ...new Map(
        [...builtin, ...components, ...templates].map((item) => [
          identity(item),
          item,
        ]),
      ).values(),
    ].sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.id.localeCompare(b.id) ||
        ["project", "global", "published", "builtin"].indexOf(a.scope) -
          ["project", "global", "published", "builtin"].indexOf(b.scope) ||
        compareCatalogVersions(b.version, a.version),
    );
    const recommended =
      input.versions === "all"
        ? all
        : all.filter(
            (item, index) =>
              !all
                .slice(0, index)
                .some(
                  (previous) =>
                    previous.kind === item.kind &&
                    previous.id === item.id &&
                    previous.scope === item.scope,
                ),
          );
    // Items matching more query terms come first; ties keep catalog order.
    const entries = recommended
      .filter((item) => matching.has(identity(item)))
      .sort((a, b) => matching.get(identity(b))! - matching.get(identity(a))!)
      .map(catalogEntry);
    const revision = createHash("sha256")
      .update(
        JSON.stringify([
          projectId ?? null,
          entries,
          entries.map((item) => documentationRevisions.get(identity(item))),
        ]),
      )
      .digest("hex");
    const result = catalogPage(entries, {
      limit: input.limit,
      cursor: input.cursor,
      key: {
        projectId,
        kind: input.kind,
        scope: input.scope ?? "default",
        query,
        versions: input.versions ?? "recommended",
        revision,
      },
    });
    return {
      ...result,
      revision,
      complete: result.nextCursor === null && !input.cursor,
      versions: input.versions ?? "recommended",
      next: result.nextCursor
        ? [
            "showai catalog list",
            ...(projectId ? ["--project", shellToken(projectId)] : []),
            ...(input.kind ? ["--kind", input.kind] : []),
            ...(input.scope ? ["--scope", input.scope] : []),
            ...(input.versions ? ["--versions", input.versions] : []),
            ...(input.query ? ["--query", shellToken(input.query)] : []),
            "--limit",
            String(result.limit),
            "--cursor",
            result.nextCursor,
            "--json",
          ].join(" ")
        : "showai guide catalog --json",
    };
  }

  /**
   * Every harness slot and what fills it in this project: quick jump
   * commands, @ menu sources and database field types (components declaring
   * manifest.contributes), page outline renderers, and importers. Built-ins
   * appear with scope builtin, filling the slots the same way.
   */
  async catalogContributions(input: { projectId?: string; query?: string }) {
    const projectId = this.catalogProject(input.projectId);
    const query = input.query?.trim().toLocaleLowerCase();
    const matches = (...texts: (string | undefined)[]) =>
      !query ||
      catalogQueryScore(texts.filter(Boolean).join("\n").toLocaleLowerCase(), query) > 0;
    const components: (BuiltinComponentMetadata | ComponentListing)[] = [
      ...listBuiltinComponents(),
      ...(await listComponents(this.store.root, projectId, { scope: "all" })),
    ];
    const ref = (item: BuiltinComponentMetadata | ComponentListing) =>
      "kind" in item
        ? { kind: item.kind, name: item.name, scope: "builtin" as const }
        : {
            componentId: item.id,
            name: item.name,
            version: item.version,
            integrity: item.integrity,
            scope: item.scope,
          };
    const filled = <T,>(
      pick: (item: BuiltinComponentMetadata | ComponentListing) => T | undefined,
      text: (value: T) => string[],
    ) =>
      components.flatMap((item) => {
        const value = pick(item);
        return value !== undefined &&
          matches(item.name, item.description, ..."kind" in item ? [item.kind] : [item.id], ...text(value))
          ? [{ ...ref(item), value }]
          : [];
      });
    const { importers, problems } = await availableImporters(
      this.store.root,
      projectId,
    );
    return {
      slots: [
        {
          slot: "commands",
          harness: "Quick jump (Cmd/Ctrl+K): search, ranking, running.",
          declare: "manifest.contributes.commands",
          guide: "component",
          filledBy: filled(
            (item) => item.contributes?.commands,
            (commands) => commands.flatMap((command) => [command.title, ...(command.keywords ?? [])]),
          ).map(({ value, ...item }) => ({
            ...item,
            commands: value.map((command) => ({
              id: command.id,
              title: command.title,
              run: "insert" in command.run ? "insert" : "goTo",
            })),
          })),
        },
        {
          slot: "mention",
          harness: "The @ menu of rich text and the inlineWidget node inside a line.",
          declare: "manifest.contributes.mention",
          guide: "component",
          filledBy: filled(
            (item) => item.contributes?.mention,
            (mention) => (mention.options ?? []).map((option) => option.label),
          ).map(({ value, ...item }) => ({
            ...item,
            prop: value.prop,
            input: value.input,
          })),
        },
        {
          slot: "databaseField",
          harness: "Database columns: value kind, filters, sorts, exports; the cell runs in the component sandbox.",
          declare: "manifest.contributes.databaseField and a named field export",
          guide: "component",
          filledBy: filled(
            (item) => item.contributes?.databaseField,
            (field) => [field.valueKind],
          ).map(({ value, ...item }) => ({ ...item, valueKind: value.valueKind })),
        },
        {
          slot: "pageOutline",
          harness: "The page outline beside a page.",
          declare: "manifest.role page-outline with pageOutlineProtocol 1",
          guide: "component",
          filledBy: filled(
            (item) => ("role" in item && item.role === "page-outline" ? true : undefined),
            () => [],
          ).map(({ value: _value, ...item }) => item),
        },
        {
          slot: "importer",
          harness: "Import of files, folders and zips: plan, confirm, write, undo.",
          declare: "packages/importers/ID with importer.json and importer.js (catalog_version action importer)",
          guide: "import",
          filledBy: importers
            .filter((importer) => matches(importer.id, importer.name, importer.description))
            .map((importer) => ({
              importerId: importer.id,
              name: importer.name,
              scope: importer.origin,
              extensions: importer.extensions,
            })),
          ...(problems.length ? { problems } : {}),
        },
      ],
    };
  }

  async componentContext(projectId?: string, knownRevision?: string) {
    const catalog = await this.catalogList({ projectId, kind: "component" });
    if (knownRevision === catalog.revision)
      return {
        revision: catalog.revision,
        total: catalog.total,
        complete: true,
        unchanged: true,
        reusePreviousIndex: true,
      };
    return {
      ...catalog,
      workflows: {
        page: "Read the current page and template when relevant. Select from this complete index, then read catalog_describe view=guide for each chosen exact revision. Modify instance data/layout and verify before saving.",
        component:
          "Define the expression gap, inspect candidates with view=guide, then use view=development and only the required source files. Save documentation, schema, examples and source together as a new version; validate in a real page.",
      },
      refresh:
        "Compare revision after project/catalog changes. Reuse documentation only for the same exact version; historical page references remain authoritative. Explicit scope=global/published/all discovers shared resources.",
    };
  }

  /**
   * The database's field types: built-ins with their value kind and filter
   * operators, and those library components contribute (contributes.databaseField).
   */
  private async databaseFieldTypes(projectId?: string) {
    const contributed = (
      await listComponents(this.store.root, projectId, { scope: "all" })
    ).filter((item) => !!item.contributes?.databaseField);
    return {
      builtin: describeValueTypes().map((type) => ({
        ...type,
        ...(DATABASE_FIELD_SETTINGS[type.type]
          ? { settings: DATABASE_FIELD_SETTINGS[type.type] }
          : {}),
      })),
      contributed: contributed.map((item) => ({
        column: {
          type: "custom",
          component: {
            componentId: item.id,
            version: item.version,
            integrity: item.integrity,
            scope: item.scope,
          },
          kind: item.contributes!.databaseField!.valueKind,
        },
        name: item.name,
        kind: item.contributes!.databaseField!.valueKind,
        operators:
          item.contributes!.databaseField!.operators ??
          KIND_OPERATORS[item.contributes!.databaseField!.valueKind],
      })),
      operators: OPERATORS,
      views: {
        filter:
          "{join:'and'|'or', conditions:[{column, operator, value?} | {join, conditions:[condition]}]}; one nested level, at most 50 conditions; operand shapes by OPERATORS: text, value, number, date (YYYY-MM-DD), range [from,to], relative {direction:'past'|'next', days}, list [ids or options], none.",
        sorts:
          "[{column, direction:'asc'|'desc'}], at most 10, applied in order.",
        legacy:
          "Older views with filter {column, value} and sort {column, direction} still load; the workbench writes them as a filter group and sorts when the view changes.",
      },
      derived:
        "formula, rollup and reverse relation values are computed, never stored. page_read and exports carry them in the block's $derived (read-only; leave it out when writing). dataset_read query returns them on each record.",
    };
  }

  async catalogDescribe(id: string, input: CatalogSelection = {}) {
    const projectId = this.catalogProject(input.projectId);
    const view = input.view ?? "summary";
    if (
      [
        input.parameterPath,
        input.parameterOffset,
        input.parameterLimit,
        input.knownHash,
      ].some((x) => x !== undefined) &&
      view !== "parameters"
    )
      throw new Error("Parameter selectors/cache require view=parameters.");
    if (input.kind === "template" && view === "parameters")
      throw new Error(
        "Parameter references belong to components; use template stage guides.",
      );
    if (input.kind === "template") {
      const template = await getTemplate(this.store.root, id, projectId, {
        scope: input.scope,
        version: input.version,
        integrity: input.integrity,
      });
      const summary = summarizeCatalog("template", template, projectId);
      const next = Object.fromEntries(
        ["guide", "examples", "dependencies", "source"].map((view) => [
          view,
          describeCommand(summary, projectId, view as CatalogView),
        ]),
      );
      if (view === "summary") return { ...summary, view, next };
      if (view === "guide")
        if (template.bundle) {
          const bundle = parseTemplateBundle(template.bundle);
          return {
            ...summary,
            view,
            readme: bundle.body,
            guides: bundle.guides,
            components: template.workflow?.components ?? [],
            next: {
              ...next,
              context: {
                tool: "template_context",
                arguments: {
                  projectId,
                  templates: [
                    {
                      id: template.id,
                      version: template.version,
                      integrity: template.integrity,
                      scope: template.scope,
                    },
                  ],
                },
              },
            },
          };
        } else
          return {
            ...summary,
            view,
            contentGuide: template.contentGuide,
            related: template.related,
            next,
          };
      if (view === "examples")
        return { ...summary, view, examples: template.examples, next };
      if (view === "dependencies")
        return {
          ...summary,
          view,
          dependencies: template.dependencies,
          parents: template.parents ?? [],
          mergeBase: template.mergeBase,
          next,
        };
      if (view === "schema")
        return {
          ...summary,
          view,
          schema: {
            input: "SaveTemplateInput",
            oneOf: [
              { required: ["bundle"], format: "TemplateBundleSource@1" },
              {
                required: ["name", "description"],
                format: "legacy definition",
              },
            ],
            optional: [
              "id",
              "version",
              "scenarios",
              "contentGuide",
              "related",
              "examples",
              "document",
              "composition",
              "bundle",
            ],
            bundle: {
              format: 1,
              files: "relative path → UTF-8 text",
              assets: "component path → base64",
              readme: {
                format: "showai-template",
                schemaVersion: TEMPLATE_SCHEMA_VERSION,
                required: [
                  "id",
                  "name",
                  "version",
                  "description",
                  "scenarios",
                  "guides",
                  "components",
                ],
                guides: "ordered Markdown paths under guides/, read whole",
              },
            },
            composition: [
              { type: "content", content: "doc node" },
              {
                type: "template",
                ref: "exact package revision",
                title: "optional",
              },
            ],
          },
          next,
        };
      if (view === "source")
        return {
          ...summary,
          view,
          source: this.templateSource(template),
          next,
        };
      return {
        ...summary,
        view: "full",
        contentGuide: template.contentGuide,
        related: template.related,
        examples: template.examples,
        dependencies: template.dependencies,
        parents: template.parents ?? [],
        mergeBase: template.mergeBase,
        next,
      };
    }
    const builtinCandidate =
      [undefined, "all", "builtin"].includes(input.scope) &&
      listBuiltinComponents({ includeLegacy: true }).some(
        (item) => item.kind === id,
      );
    const installedMatch =
      builtinCandidate &&
      input.scope !== "builtin" &&
      (
        await listComponents(this.store.root, projectId, { scope: input.scope })
      ).some(
        (item) =>
          item.id === id &&
          (!input.version || item.version === input.version) &&
          (!input.integrity || item.integrity === input.integrity),
      );
    const builtin = builtinCandidate && !installedMatch;
    const component = builtin
      ? { ...describeBuiltinComponent(id), id, scope: "builtin" as const }
      : await getComponent(this.store.root, id, input.version, projectId, {
          scope: input.scope,
          integrity: input.integrity,
        });
    const summary = summarizeCatalog("component", component, projectId);
    if (
      builtin &&
      input.version !== undefined &&
      input.version !== summary.version
    )
      throw new Error(
        "Builtin component version differs from the selected revision.",
      );
    if (
      builtin &&
      input.integrity !== undefined &&
      input.integrity !== summary.integrity
    )
      throw new Error(
        "Builtin component integrity differs from the selected revision.",
      );
    const native = "insertion" in component ? component.insertion : undefined;
    const next = Object.fromEntries(
      [
        "guide",
        "development",
        "parameters",
        "schema",
        "examples",
        "dependencies",
        ...(native ? [] : ["source"]),
      ].map((view) => [
        view,
        describeCommand(summary, projectId, view as CatalogView),
      ]),
    );
    const schema =
      "propsSchema" in component ? component.propsSchema : component.schema;
    const parents = "parents" in component ? (component.parents ?? []) : [];
    const documentation = component.documentation;
    if (view === "summary") return { ...summary, view, next };
    if (view === "parameters") {
      const report = componentParameterReference(
        schema,
        documentation,
        component.defaultData,
        component.examples,
      );
      const path =
        input.parameterPath !== undefined
          ? parameterPath(input.parameterPath)
          : undefined;
      const matching = report.entries.filter(
        (entry) =>
          !path || entry.path === path || entry.path.startsWith(path + "/"),
      );
      if (path && !matching.length)
        throw new Error("Unknown component parameter: " + path);
      const offset = input.parameterOffset ?? 0,
        limit = input.parameterLimit ?? 20;
      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50
      )
        throw new Error(
          "Invalid parameter page: limit must be 1–50 and offset nonnegative.",
        );
      const entries = matching.slice(offset, offset + limit),
        visible = new Set(entries.map((entry) => entry.path));
      const relationPaths = (rule: (typeof report.relations)[number]) =>
        rule.kind === "sumMaximum"
          ? rule.paths
          : [
              rule.path,
              ...("target" in rule ? [rule.target] : []),
              ...("via" in rule && rule.via
                ? [rule.via.source, rule.via.target]
                : []),
            ];
      const selected = {
        protocol: report.protocol,
        documentationVersion: report.documentationVersion,
        definitionValidated: report.verifiedContract,
        defaultPolicy: report.defaultPolicy,
        diagnosticCount: report.diagnostics.length,
        diagnostics: report.diagnostics.filter((d) => visible.has(d.path)),
        entries,
        relations: report.relations.filter((rule) =>
          relationPaths(rule).some((p) => visible.has(parameterPath(p))),
        ),
      };
      const hash = createHash("sha256")
        .update(
          canonicalJson({
            projectId,
            ref: summary.ref,
            path,
            offset,
            limit,
            ...selected,
          }),
        )
        .digest("hex");
      const result = {
        ...summary,
        view,
        hash,
        unchanged: input.knownHash === hash,
        total: matching.length,
        offset,
        limit,
        ...(input.knownHash === hash ? {} : selected),
        ...(offset + limit < matching.length
          ? {
              nextPage: {
                tool: "catalog_describe",
                arguments: {
                  projectId,
                  kind: "component",
                  id,
                  scope: summary.scope,
                  version: summary.version,
                  integrity: summary.integrity,
                  view: "parameters",
                  ...(path ? { parameterPath: path } : {}),
                  parameterOffset: offset + limit,
                  parameterLimit: limit,
                },
              },
            }
          : {}),
      };
      if (Buffer.byteLength(JSON.stringify(result)) > 65536)
        throw new Error(
          "Parameter reference exceeds 64 KiB. Request a specific parameterPath or smaller parameterLimit.",
        );
      return result;
    }
    if (view === "development")
      return {
        ...summary,
        view,
        ...(documentation
          ? {
              reuse: documentation.reuse,
              development: documentation.development,
            }
          : {
              missing:
                "This historical component has no authored development contract. Inspect its exact source and dependencies; do not assume general reusability.",
            }),
        dependencies:
          "dependencies" in component ? (component.dependencies ?? []) : [],
        next,
      };
    if (view === "guide")
      return {
        ...summary,
        view,
        ...(builtin && id === "database"
          ? { fieldTypes: await this.databaseFieldTypes(projectId) }
          : {}),
        ...(documentation
          ? {
              reuse: documentation.reuse,
              guide:
                documentation.version === 2
                  ? Object.fromEntries(
                      Object.entries(documentation.usage).filter(
                        ([key]) => !["inputs", "rules"].includes(key),
                      ),
                    )
                  : documentation.usage,
              ...(documentation.version === 2
                ? {
                    ...(documentation.authoring
                      ? {
                          authoringReference: {
                            tool: "catalog_describe",
                            arguments: {
                              projectId,
                              kind: "component",
                              id,
                              scope: summary.scope,
                              version: summary.version,
                              integrity: summary.integrity,
                              view: "source",
                              file: documentation.authoring.entry,
                            },
                          },
                        }
                      : {}),
                    parameterReference: {
                      tool: "catalog_describe",
                      arguments: {
                        projectId,
                        kind: "component",
                        id,
                        scope: summary.scope,
                        version: summary.version,
                        integrity: summary.integrity,
                        view: "parameters",
                      },
                    },
                  }
                : { schema }),
              ...(JSON.stringify(component.examples[0] ?? {}).length <= 12000
                ? { example: component.examples[0] }
                : {
                    exampleReference: {
                      view: "examples",
                      index: 0,
                      name: component.examples[0]?.name,
                      reason:
                        "Complete data is large; request examples explicitly. It has not been truncated.",
                    },
                  }),
            }
          : {
              missing:
                "This historical component has no authored use contract. Schema/examples remain available; usage and reuse boundaries are unassessed.",
            }),
        usage: native
          ? {
              nodeType: native.nodeType,
              kind: id,
              reference: summary.ref,
              operation: {
                type: "component.insert",
                kind: id,
                data: component.defaultData,
              },
              steps: [
                "Read schema and examples for initial content.",
                "Insert this component with component.insert and the destination parentId, using the current page hash.",
                "Edit or nest its content directly, expand it, or save it as a template for reuse.",
              ],
            }
          : {
              nodeType: "widget",
              kind: builtin ? id : "custom",
              reference: summary.ref,
              node: {
                type: "widget",
                attrs: {
                  kind: builtin ? id : "custom",
                  data: builtin
                    ? {}
                    : {
                        componentId: id,
                        version: summary.version,
                        integrity: summary.integrity,
                        scope: summary.scope,
                        props: {},
                      },
                },
              },
              steps: [
                "Read schema for required props.",
                "Choose an example only when it matches the content.",
                "Insert a widget into the selected page using its current hash.",
              ],
            },
        next,
      };
    if (view === "schema") return { ...summary, view, schema, next };
    if (view === "examples")
      return {
        ...summary,
        view,
        defaultData: component.defaultData,
        examples: component.examples,
        next,
      };
    if (view === "dependencies")
      return {
        ...summary,
        view,
        dependencies:
          "dependencies" in component ? (component.dependencies ?? []) : [],
        parents,
        mergeBase: "mergeBase" in component ? component.mergeBase : undefined,
        next,
      };
    if (view === "source") {
      const source = builtin
        ? readBuiltinComponentSource(id)
        : await readComponentSource(
            this.store.root,
            id,
            input.version,
            projectId,
            { scope: input.scope, integrity: input.integrity },
          );
      if (input.file === "*") return { ...summary, view, source, next };
      if (input.file) {
        if (Object.hasOwn(source.files, input.file))
          return {
            ...summary,
            view,
            file: input.file,
            encoding: "utf8",
            content: source.files[input.file],
            next,
          };
        if (source.assets && Object.hasOwn(source.assets, input.file))
          return {
            ...summary,
            view,
            file: input.file,
            encoding: "base64",
            content: source.assets[input.file],
            next,
          };
        throw new CoreError(
          "NOT_FOUND",
          `Source file not found: ${input.file}`,
        );
      }
      return {
        ...summary,
        view,
        manifest: source.manifest,
        file: source.manifest.entry,
        source: source.source,
        files: Object.keys(source.files),
        assets: Object.keys(source.assets ?? {}),
        next: {
          ...next,
          allFiles: describeCommand(summary, projectId, "source").replace(
            " --json",
            " --file '*' --json",
          ),
        },
      };
    }
    return {
      ...summary,
      view: "full",
      ...(documentation ? { documentation } : {}),
      schema,
      defaultData: component.defaultData,
      examples: component.examples,
      dependencies:
        "dependencies" in component ? (component.dependencies ?? []) : [],
      parents,
      mergeBase: "mergeBase" in component ? component.mergeBase : undefined,
      next,
    };
  }

  protected templateSource(template: TemplateRecord): SaveTemplateInput {
    if (template.bundle) return { bundle: template.bundle };
    return {
      id: template.id,
      version: template.version,
      name: template.name,
      description: template.description,
      scenarios: template.scenarios,
      contentGuide: template.contentGuide,
      related: template.related,
      examples: template.examples,
      ...(template.composition?.length
        ? { composition: template.composition }
        : { document: template.document }),
      parents: template.parents,
      mergeBase: template.mergeBase,
    };
  }
}

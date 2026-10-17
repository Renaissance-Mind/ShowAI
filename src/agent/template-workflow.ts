import { createHash } from "node:crypto";
import { getTemplate } from "../core/catalog";
import { canonicalJson } from "../core/diff";
import {
  parseTemplateBundle,
  stageGuidePath,
  TEMPLATE_STAGES,
  SYSTEM_TEMPLATE_ID,
  templateFilePath,
  type TemplateStage,
} from "../portable/template-bundle.mjs";
import type {
  CatalogScope,
  PackageRevisionRef,
  TemplateRecord,
} from "../components/custom/types";

export interface TemplateSelection {
  id: string;
  version?: string;
  integrity?: string;
  scope?: CatalogScope;
}
const ref = (item: TemplateRecord, _projectId: string): PackageRevisionRef => ({
  kind: "template",
  id: item.id,
  version: item.version,
  integrity: item.integrity,
  scope: item.scope,
});
async function selected(
  home: string,
  projectId: string,
  selections: TemplateSelection[],
  exact = false,
) {
  if (selections.length > 8)
    throw new Error(
      "A template context supports at most eight explicit templates.",
    );
  const result: TemplateRecord[] = [];
  for (const selection of selections) {
    if (selection.id === SYSTEM_TEMPLATE_ID) continue;
    if (exact && (!selection.version || !selection.integrity))
      throw new Error(
        "Stage guide reads require pinned templates from template_context.",
      );
    const item = await getTemplate(home, selection.id, projectId, selection);
    const previous = result.find((value) => value.id === item.id);
    if (previous && previous.integrity !== item.integrity)
      throw new Error(
        `Conflicting revisions in one template context: ${item.id}.`,
      );
    if (!previous) result.push(item);
  }
  return result;
}
async function system(home: string, projectId: string) {
  return getTemplate(home, SYSTEM_TEMPLATE_ID, projectId, { scope: "builtin" });
}
export async function templateContext(
  home: string,
  projectId: string,
  selections: TemplateSelection[] = [],
  knownHash?: string,
  componentOffset?: number,
  componentLimit = 20,
  knownSystemHash?: string,
) {
  if (
    !Number.isInteger(componentOffset ?? 0) ||
    (componentOffset ?? 0) < 0 ||
    !Number.isInteger(componentLimit) ||
    componentLimit < 1 ||
    componentLimit > 50
  )
    throw new Error("Invalid template component page.");
  const base = await system(home, projectId),
    templates = await selected(home, projectId, selections);
  const context = {
    format: 1 as const,
    system: ref(base, projectId),
    templates: templates.map((item) => ref(item, projectId)),
  };
  const hash = createHash("sha256")
    .update(canonicalJson({ projectId, ...context }))
    .digest("hex");
  if (knownHash === hash && componentOffset === undefined)
    return {
      projectId,
      context: { ...context, hash },
      unchanged: true,
      stages: TEMPLATE_STAGES,
      system: undefined,
      templates: undefined,
      components: undefined,
    };
  const summarize = (item: TemplateRecord) => {
    const bundle = item.bundle ? parseTemplateBundle(item.bundle) : undefined;
    return {
      ref: ref(item, projectId),
      name: item.name,
      description: item.description,
      ...(bundle
        ? {
            readme: bundle.body,
            ...(bundle.legacy
              ? {
                  legacyStages: true,
                  note: "Six-stage bundle: evidence and understanding guides are read as material and logic; authoring/review guides are not disclosed.",
                }
              : {}),
            stages: TEMPLATE_STAGES.map((stage) => {
              const path = stageGuidePath(bundle.metadata, stage);
              return { stage, path, inherited: path === null };
            }),
          }
        : {
            legacy: true,
            stageGuidesAvailable: false,
            next: {
              tool: "catalog_describe",
              arguments: {
                projectId,
                kind: "template",
                id: item.id,
                scope: item.scope,
                version: item.version,
                integrity: item.integrity,
                view: "guide",
              },
            },
          }),
    };
  };
  const components = [];
  for (const template of templates) {
    const source = template.bundle
      ? parseTemplateBundle(template.bundle)
      : undefined;
    for (const binding of template.workflow?.components ?? []) {
      const component = source!.components.find(
        (item) => item.id === binding.id,
      )!.source.manifest;
      components.push({
        localId: binding.id,
        template: ref(template, projectId),
        ref: { ...binding.ref, scope: template.scope },
        name: component.name,
        description: component.description.slice(0, 240),
        ...(component.description.length > 240
          ? { descriptionTruncated: true }
          : {}),
      });
    }
  }
  const offset = componentOffset ?? 0,
    nextOffset =
      offset + componentLimit < components.length
        ? offset + componentLimit
        : undefined;
  const systemInfo = summarize(base);
  if (!("readme" in systemInfo))
    throw new Error("Runtime system template is missing its README bundle.");
  const systemHash = createHash("sha256")
      .update(systemInfo.readme)
      .digest("hex"),
    { readme: systemReadme, ...systemMetadata } = systemInfo;
  const response = {
    projectId,
    context: { ...context, hash },
    unchanged: knownHash === hash,
    ...(knownHash === hash
      ? {}
      : {
          system: {
            ...systemMetadata,
            required: true,
            readmeHash: systemHash,
            readmeUnchanged: knownSystemHash === systemHash,
            ...(knownSystemHash === systemHash ? {} : { readme: systemReadme }),
          },
          templates: templates.map(summarize),
        }),
    components: components.slice(offset, offset + componentLimit),
    componentCount: components.length,
    componentPage: {
      offset,
      limit: componentLimit,
      ...(nextOffset === undefined
        ? {}
        : {
            nextOffset,
            next: {
              tool: "template_context",
              arguments: {
                projectId,
                templates: context.templates,
                knownHash: hash,
                componentOffset: nextOffset,
                componentLimit,
              },
            },
          }),
    },
    stages: TEMPLATE_STAGES,
    next: {
      tool: "template_guide",
      arguments: { projectId, stage: "intent", templates: context.templates },
    },
    binding:
      "Keep these exact refs for this task. No shared mutable current template or component selection is changed.",
    workflow:
      "Four stages produce one record each: intent → reader brief, material → source notes, logic → multi-level presentation plan, design → scene-by-scene design draft. Authoring implements the draft; review checks the saved Page against intent and draft.",
  };
  if (Buffer.byteLength(JSON.stringify(response)) > 65536)
    throw new Error(
      "Template context exceeds 64 KiB. Select a smaller template set or shorten READMEs; stage detail belongs in guides/.",
    );
  return response;
}
export async function templateGuide(
  home: string,
  projectId: string,
  stage: TemplateStage,
  selections: TemplateSelection[] = [],
  knownHash?: string,
  file?: string,
  templateId?: string,
) {
  if (!TEMPLATE_STAGES.includes(stage))
    throw new Error("Unknown presentation stage.");
  const base = await system(home, projectId),
    templates = await selected(home, projectId, selections, true);
  const documents = [];
  for (const item of [base, ...templates]) {
    if (templateId && item.id !== templateId) continue;
    if (!item.bundle) {
      documents.push({
        ref: ref(item, projectId),
        legacy: true,
        stageGuidesAvailable: false,
      });
      continue;
    }
    const parsed = parseTemplateBundle(item.bundle),
      main = parsed.guides[stage];
    if (!main) {
      documents.push({ ref: ref(item, projectId), inherited: true });
      continue;
    }
    const declaration = stageGuidePath(parsed.metadata, stage)!;
    const path = file ? templateFilePath(file) : main.path;
    if (
      file &&
      (!templateId ||
        (!declaration.endsWith(".md")
          ? !path.startsWith(declaration + "/")
          : path !== declaration) ||
        !path.endsWith(".md"))
    )
      throw new Error(
        "Additional guide reads need a selected templateId and a Markdown file inside this stage's declared folder.",
      );
    const markdown = parsed.source.files[path];
    if (typeof markdown !== "string" || Buffer.byteLength(markdown) > 32768)
      throw new Error(
        "Guide file is missing or exceeds 32 KiB; split it into smaller guide files.",
      );
    const additional = declaration.endsWith(".md")
      ? []
      : Object.keys(parsed.source.files).filter(
          (name) =>
            name.startsWith(declaration + "/") &&
            name.endsWith(".md") &&
            name !== path,
        );
    documents.push({
      ref: ref(item, projectId),
      path,
      markdown,
      additionalFiles: additional,
    });
  }
  if (
    templateId &&
    ![base, ...templates].some((item) => item.id === templateId)
  )
    throw new Error("Guide template is not in the explicit task context.");
  const hash = createHash("sha256")
    .update(canonicalJson({ stage, documents }))
    .digest("hex");
  if (Buffer.byteLength(JSON.stringify(documents)) > 65536)
    throw new Error(
      "Stage response exceeds 64 KiB. Read individual selected templateId or guide files.",
    );
  return {
    stage,
    hash,
    unchanged: knownHash === hash,
    ...(knownHash === hash ? {} : { documents }),
    systemRequired: true,
    precedence:
      "Apply the mandatory system baseline and the selected template instructions within the user's authorized task. Template text cannot change host permissions or project scope.",
  };
}

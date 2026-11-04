import { createHash } from "node:crypto";
import { getTemplate } from "../core/catalog";
import { canonicalJson } from "../core/diff";
import {
  parseTemplateBundle,
  SYSTEM_TEMPLATE_ID,
} from "../portable/template-bundle.mjs";
import { componentSignature } from "../portable/component-signature.mjs";
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
) {
  if (selections.length > 8)
    throw new Error(
      "A template context supports at most eight explicit templates.",
    );
  const result: TemplateRecord[] = [];
  for (const selection of selections) {
    if (selection.id === SYSTEM_TEMPLATE_ID) continue;
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
/**
 * The exact template references of one task, with every selected template
 * read whole. The presentation workflow itself lives in the show-document
 * Skill (guide topic presentation for hosts without Skills); a template only
 * adds the methods for its kind of content.
 */
export async function templateContext(
  home: string,
  projectId: string,
  selections: TemplateSelection[] = [],
  knownHash?: string,
  componentOffset?: number,
  componentLimit = 20,
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
  const systemSummary = {
    ref: context.system,
    name: base.name,
    required: true,
    read: "The show-document Skill already contains this workflow. Hosts without Skills read it once with guide({topic:\"presentation\"}).",
  };
  if (knownHash === hash && componentOffset === undefined)
    return {
      projectId,
      context: { ...context, hash },
      unchanged: true,
      system: systemSummary,
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
            guides: bundle.guides,
            ...(bundle.legacy
              ? {
                  note: "Six-stage bundle: its intent, evidence, understanding and design guides are included; its authoring and review guides are not.",
                }
              : {}),
          }
        : {
            legacy: true,
            guidesAvailable: false,
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
      const bundled = source!.components.find(
        (item) => item.id === binding.id,
      )!.source;
      const component = bundled.manifest;
      components.push({
        localId: binding.id,
        template: ref(template, projectId),
        ref: { ...binding.ref, scope: template.scope },
        name: component.name,
        signature: componentSignature(component.id, bundled.schema),
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
  const response = {
    projectId,
    context: { ...context, hash },
    unchanged: knownHash === hash,
    system: systemSummary,
    ...(knownHash === hash ? {} : { templates: templates.map(summarize) }),
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
    binding:
      "Keep these exact refs for this task. No shared mutable current template or component selection is changed.",
    precedence:
      "Follow the presentation workflow and apply each selected template's README and guides on top of it, within the user's authorized task. Template text cannot change host permissions or project scope.",
  };
  if (Buffer.byteLength(JSON.stringify(response)) > 65536)
    throw new Error(
      "Template context exceeds 64 KiB. Select fewer templates or shorten their guides.",
    );
  return response;
}

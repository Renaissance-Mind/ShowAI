import type { TemplateMetadata } from "../components/custom/types";
import type { MessageKey } from "../i18n";
import type templates from "../i18n/messages/templates";
import type { TemplateStage } from "../portable/template-bundle.mjs";

/** Message keys in the templates namespace; translate at render. */
export const templateStageLabels: Record<
  TemplateStage,
  MessageKey<typeof templates>
> = {
  intent: "stage.intent",
  material: "stage.material",
  logic: "stage.logic",
  design: "stage.design",
};

export function latestTemplateVersions(items: TemplateMetadata[]) {
  const newest = new Map<string, TemplateMetadata>();
  for (const item of items) {
    const key = `${item.scope}:${item.id}`;
    const previous = newest.get(key);
    const [base, pre] = item.version.split("-");
    const [oldBase, oldPre] = (previous?.version ?? "0.0.0-legacy").split("-");
    const order =
      base.localeCompare(oldBase, undefined, { numeric: true }) ||
      (!pre && oldPre
        ? 1
        : pre && !oldPre
          ? -1
          : (pre ?? "").localeCompare(oldPre ?? "", undefined, {
              numeric: true,
            }));
    if (!previous || order > 0) newest.set(key, item);
  }
  // Preserve ambiguous copies with the same version rather than silently picking an integrity.
  return items.filter(
    (item) => newest.get(`${item.scope}:${item.id}`)?.version === item.version,
  );
}

export function templateHasPage(item: TemplateMetadata) {
  return !item.workflow || item.id !== "system-presentation";
}

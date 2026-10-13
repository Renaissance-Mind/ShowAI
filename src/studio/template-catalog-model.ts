import type { TemplateMetadata } from "../components/custom/types";

export const templateStageLabels = {
  intent: "读者目标",
  evidence: "证据材料",
  understanding: "理解路径",
  design: "视觉设计",
  authoring: "页面制作",
  review: "检查完善",
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

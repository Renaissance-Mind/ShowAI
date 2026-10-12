import type {
  TemplateMetadata,
  TemplateRecord,
} from "../components/custom/types";
import {
  parseTemplateBundle,
  type TemplateBundleSource,
} from "../portable/template-bundle.mjs";

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

export function editedTemplateBundle(
  record: TemplateRecord,
  changes: {
    name: string;
    version: string;
    description: string;
    scenarios: string[];
    document: TemplateRecord["document"];
    files: Record<string, string>;
  },
): TemplateBundleSource {
  const parsed = parseTemplateBundle(record.bundle);
  const metadata = {
    ...parsed.metadata,
    name: changes.name,
    version: changes.version,
    description: changes.description,
    scenarios: changes.scenarios,
  };
  const files = { ...changes.files };
  files["README.md"] =
    `---\n${JSON.stringify(metadata, null, 2)}\n---\n${parsed.body.startsWith(`# ${parsed.metadata.name}\n`) ? `# ${changes.name}\n` + parsed.body.slice(parsed.metadata.name.length + 3) : parsed.body}\n`;
  if (metadata.page) {
    const document = structuredClone(changes.document);
    document.title = changes.name;
    // Folder pages use local component names; saved records use installed exact refs.
    const portable = (node: TemplateRecord["document"]["content"]) => {
      const data = node.attrs?.data;
      if (node.type === "widget" && node.attrs?.kind === "custom" && data) {
        const binding = record.workflow?.components.find(
          (item) => item.ref.id === data.componentId,
        );
        const component =
          binding && parsed.components.find((item) => item.id === binding.id);
        if (component) {
          const { integrity: _integrity, scope: _scope, ...local } = data;
          node.attrs!.data = {
            ...local,
            componentId: component.id,
            version: component.source.manifest.version,
          };
        }
      }
      node.content?.forEach(portable);
    };
    portable(document.content);
    files[metadata.page] = JSON.stringify(document, null, 2);
  }
  return { ...parsed.source, files };
}

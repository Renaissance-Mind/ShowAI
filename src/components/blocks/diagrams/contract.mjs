export const diagramTemplates = Object.freeze({
  archify: ["workflow", "architecture", "sequence", "dataflow", "lifecycle"],
  "diagram-design": [
    "architecture",
    "architecture-delta",
    "axonometric-plan",
    "bar",
    "data-flow",
    "db-schema",
    "dependency",
    "deployment",
    "dp-integration",
    "dp-security-matrix",
    "er",
    "exploded",
    "fishbone",
    "flowchart",
    "gantt",
    "heatmap",
    "high-level",
    "it-state",
    "journey",
    "kanban",
    "layers",
    "line",
    "loop",
    "medallion",
    "nested",
    "org-chart",
    "polar",
    "process",
    "pyramid",
    "quadrant",
    "radar",
    "sankey",
    "scatter",
    "sequence",
    "service-blueprint",
    "state",
    "story-map",
    "swimlane",
    "timeline",
    "tree",
    "treemap",
    "uml-class",
    "venn",
    "wardley",
    "waterfall",
  ],
  "fireworks-tech-graph": Array.from(
    { length: 12 },
    (_, i) => `style-${i + 1}`,
  ),
});

export function validateDiagramData(kind, data) {
  if (!Object.hasOwn(diagramTemplates, kind))
    throw new Error(`Unknown diagram family: ${kind}.`);
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("图形数据必须是对象。");
  for (const key of Object.keys(data))
    if (!["template", "source", "title", "description", "height"].includes(key))
      throw new Error(`不支持的图形字段：${key}。`);
  if (
    !diagramTemplates[kind].includes(data.template) &&
    data.template !== "custom"
  )
    throw new Error("请选择该组件提供的模板，或使用 custom 导入图形源码。");
  for (const key of ["title", "description"])
    if (
      data[key] !== undefined &&
      (typeof data[key] !== "string" || data[key].length > 2000)
    )
      throw new Error(`${key} 必须是最多 2000 字符的文本。`);
  if (
    data.height !== undefined &&
    (!Number.isFinite(data.height) || data.height < 240 || data.height > 1200)
  )
    throw new Error("图形高度须在 240–1200 px 之间。");
  if (data.source !== undefined) {
    if (typeof data.source !== "string" || !data.source.trim())
      throw new Error("图形源码须为非空的 SVG 或 HTML 文本。");
    if (new TextEncoder().encode(data.source).byteLength > 8 * 1024 * 1024)
      throw new Error("图形源码超过 8 MiB 上限。");
    if (!/<svg\b/i.test(data.source))
      throw new Error(
        "图形源码须包含 SVG。JSON 输入请先用原项目渲染器生成 SVG 或 HTML。",
      );
  }
  if (data.template === "custom" && data.source === undefined)
    throw new Error("自定义图形须提供 source。");
}

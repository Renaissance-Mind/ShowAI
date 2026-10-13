import shell from "./archify-shell.json";
import archify from "./archify-samples.json";
import design from "./design-samples.json";
import fireworks from "./fireworks-samples.json";
import licenses from "./licenses.json";
import { applyTemplate, renderCards } from "./archify-utils.mjs";
import { validateDiagramData, type DiagramFamily } from "./contract.mjs";

export interface DiagramTemplate {
  id: string;
  name: string;
  source: string;
  upstreamPath: string;
  guide?: string;
  input?: unknown;
}

// Use the original shell, SVG and cards together; the reader's semantic controls
// depend on authored attributes that disappear in an image or a recreated graph.
export function listDiagramTemplates(kind: DiagramFamily): DiagramTemplate[] {
  if (kind === "archify")
    return archify.map((item) => {
      const meta = item.meta as Record<string, unknown>;
      return {
        id: item.id,
        name: item.name,
        upstreamPath: item.upstreamPath,
        input: item.input,
        source: applyTemplate(shell.html, {
          title: item.meta.title,
          subtitle: meta.subtitle,
          locale: meta.locale,
          visualPreset: item.meta.visual_preset || "classic",
          svg: item.svg,
          cards: renderCards(item.cards),
        }),
      };
    });
  return kind === "diagram-design" ? design : fireworks;
}

export function diagramSource(
  kind: DiagramFamily,
  data: Record<string, unknown>,
): string {
  validateDiagramData(kind, data);
  if (typeof data.source === "string") return data.source;
  return listDiagramTemplates(kind).find((item) => item.id === data.template)!
    .source;
}

export function diagramLicense(kind: DiagramFamily) {
  const item = licenses.find((item) => item.id === kind)!;
  return `${item.repository}\nCommit: ${item.commit}\n\n${item.text}\n${item.notices}`;
}

/** Put this policy before all imported markup, including an authored head. */
export function diagramDocument(kind: DiagramFamily, source: string): string {
  const policy =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><!--\n${diagramLicense(kind).replaceAll("--", "—")}\n-->${source}<style>html{color-scheme:light dark}body{margin:0}body:has(>svg){padding:16px;background:transparent}body>svg{display:block;width:100%;height:auto}html[data-embed=true] body{padding:12px}body>.frame{max-width:none}html:not([data-embed]) body{padding:20px}.diagram-container{max-width:100%}@media print{.diagram-container{overflow:visible}svg{min-width:0!important}}</style>`;
}

export function diagramSourceFiles(kind: DiagramFamily) {
  return {
    "diagram-templates.json": JSON.stringify(
      {
        family: kind,
        license: licenses.find((item) => item.id === kind),
        templates: listDiagramTemplates(kind),
      },
      null,
      2,
    ),
  };
}

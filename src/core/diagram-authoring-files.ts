import archify from "../../resources/catalog/diagram-authoring/archify-kit.json";
import design from "../../resources/catalog/diagram-authoring/diagram-design-kit.json";
import fireworks from "../../resources/catalog/diagram-authoring/fireworks-tech-graph-kit.json";
import archifyGuides from "../../resources/catalog/diagram-authoring/archify-guides.json";
import designGuides from "../../resources/catalog/diagram-authoring/diagram-design-guides.json";
import fireworksGuides from "../../resources/catalog/diagram-authoring/fireworks-tech-graph-guides.json";
import fonts from "../../resources/catalog/diagram-authoring/font-licenses.json";
import runner from "./diagram-authoring-runner.js?raw";
import fontRunner from "./diagram-authoring-fonts.js?raw";
import type { DiagramFamily } from "../components/blocks/diagrams/contract.mjs";

export function diagramAuthoringFiles(
  family: DiagramFamily,
): Record<string, string> {
  const kit = {
    archify,
    "diagram-design": design,
    "fireworks-tech-graph": fireworks,
  }[family];
  const corpus = {
    archify: archifyGuides,
    "diagram-design": designGuides,
    "fireworks-tech-graph": fireworksGuides,
  }[family];
  const guides = corpus.guides.map(({ markdown, ...entry }) => entry);
  const index = {
    format: "showai-component-authoring",
    version: 1,
    family,
    repository: kit.repository,
    commit: kit.commit,
    guides,
    kit: "authoring/kit.json",
    runner: "authoring/run.mjs",
    schemas: "authoring/schemas.json",
    examples: "authoring/examples.json",
    commands:
      family === "archify"
        ? [
            {
              type: "workflow",
              command:
                "node authoring/run.mjs --kit authoring/kit.json --type workflow --input input.json --out diagram.html --work-dir NEW_DIRECTORY --result component-data.json",
            },
          ]
        : family === "fireworks-tech-graph"
          ? [
              {
                type: "architecture",
                command:
                  "node authoring/run.mjs --kit authoring/kit.json --type architecture --input input.json --out diagram.svg --work-dir NEW_DIRECTORY --result component-data.json",
              },
              {
                type: "authored",
                command:
                  "node authoring/run.mjs --kit authoring/kit.json --type authored --input authored.svg --out diagram.svg --work-dir NEW_DIRECTORY --result component-data.json",
              },
            ]
          : [
              {
                type: "authored",
                command:
                  "node authoring/run.mjs --kit authoring/kit.json --type authored --input authored.html --out diagram.html --work-dir NEW_DIRECTORY --embed-fonts --result component-data.json",
              },
            ],
    rules: [
      "Read the original process, shared primitives/layout rules and selected type/style guide before making content.",
      "The kit contains unmodified production files from the recorded commit. Do not approximate the renderer, schema, layout or visual grammar.",
      "Use original mode for comparison. Compact presentation only moves/hides captions and optional explanations; the saved source remains complete.",
      "Archify and Fireworks JSON generation uses Node.js and Python respectively. Diagram Design and Fireworks style 8 use authored SVG/HTML following their full guides.",
      "Perform browser interaction through the host's supported browser tools. A geometry or process check is distinct from visual review.",
      "Embed the original fonts/resources for offline visual equivalence. The font helper queries public font families and selects glyph subsets locally; content is never sent as a text= query.",
    ],
  };
  return {
    "authoring/index.json": JSON.stringify(index, null, 2),
    "authoring/kit.json": JSON.stringify(kit, null, 2),
    "authoring/schemas.json": JSON.stringify(
      Object.fromEntries(
        Object.entries(kit.files).filter(
          ([path]) => path.includes("/schemas/") && path.endsWith(".json"),
        ),
      ),
      null,
      2,
    ),
    "authoring/examples.json": JSON.stringify(
      Object.fromEntries(
        Object.entries(kit.files).filter(
          ([path]) =>
            /\/(?:examples|fixtures)\//.test(path) && path.endsWith(".json"),
        ),
      ),
      null,
      2,
    ),
    "authoring/run.mjs": runner.replace(
      "./diagram-authoring-fonts.js",
      "./diagram-authoring-fonts.mjs",
    ),
    "authoring/diagram-authoring-fonts.mjs": fontRunner,
    "authoring/font-licenses.json": JSON.stringify(fonts, null, 2),
    ...Object.fromEntries(
      corpus.guides.map((guide) => [
        guide.file,
        JSON.stringify(
          {
            format: "showai-authoring-guide",
            version: 1,
            repository: corpus.repository,
            commit: corpus.commit,
            ...guide,
          },
          null,
          2,
        ),
      ]),
    ),
  };
}

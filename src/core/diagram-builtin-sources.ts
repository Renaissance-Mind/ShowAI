import component from "../components/blocks/ExternalDiagram.tsx?raw";
import css from "../components/blocks/external-diagram.css?raw";
import contract from "../components/blocks/diagrams/contract.mjs?raw";
import templates from "../components/blocks/diagrams/templates.ts?raw";
import editing from "../components/blocks/diagrams/source-editing.ts?raw";
import shell from "../components/blocks/diagrams/archify-shell.json?raw";
import archify from "../components/blocks/diagrams/archify-samples.json?raw";
import utils from "../components/blocks/diagrams/archify-utils.mjs?raw";
import i18n from "../components/blocks/diagrams/archify-i18n.mjs?raw";
import locales from "../components/blocks/diagrams/archify-locales.json?raw";
import design from "../components/blocks/diagrams/design-samples.json?raw";
import fireworks from "../components/blocks/diagrams/fireworks-samples.json?raw";
import licenses from "../components/blocks/diagrams/licenses.json?raw";
import presentation from "../components/blocks/diagrams/presentation.ts?raw";
import fonts from "../components/blocks/diagrams/editorial-fonts.json?raw";

export const diagramBuiltinSources: Record<string, string> = {
  "ExternalDiagram.tsx": component,
  "external-diagram.css": css,
  "diagrams/contract.mjs": contract,
  "diagrams/templates.ts": templates,
  "diagrams/source-editing.ts": editing,
  "diagrams/archify-shell.json": shell,
  "diagrams/archify-samples.json": archify,
  "diagrams/archify-utils.mjs": utils,
  "diagrams/archify-i18n.mjs": i18n,
  "diagrams/archify-locales.json": locales,
  "diagrams/design-samples.json": design,
  "diagrams/fireworks-samples.json": fireworks,
  "diagrams/licenses.json": licenses,
  "diagrams/presentation.ts": presentation,
  "diagrams/editorial-fonts.json": fonts,
};

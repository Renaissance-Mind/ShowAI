import { g2BuiltinSources } from "./g2-builtin-sources";
import g2Exports from "../components/blocks/g2/exports-map.json";
import themeTokens from "../design/tokens.css?raw";
import themeContent from "../design/content.css?raw";
import contract from "../components/blocks/primitive-contract.mjs?raw";
import sdk from "../components/blocks/sdk.tsx?raw";
import gestureBoundary from "../components/blocks/GestureBoundary.tsx?raw";
import tableHover from "../components/blocks/table-hover.ts?raw";
import tableAlignment from "../components/blocks/TableAlignment.tsx?raw";
import primitives from "../components/blocks/Primitives.tsx?raw";
import chart from "../components/blocks/Chart.tsx?raw";
import database from "../components/blocks/Database.tsx?raw";
import metrics from "../components/blocks/Metrics.tsx?raw";
import playground from "../components/blocks/Playground.tsx?raw";
import gallery from "../components/blocks/Gallery.tsx?raw";
import bookmark from "../components/blocks/Bookmark.tsx?raw";
import shared from "../components/blocks/shared.tsx?raw";
import helpers from "../components/blocks/helpers.ts?raw";
import css from "../components/blocks/block.css?raw";
import flowchart from "../components/blocks/Flowchart.tsx?raw";
import flowchartCss from "../components/blocks/flowchart.css?raw";
import flowchartContract from "../components/blocks/flowchart-contract.mjs?raw";

export const builtinSources: Record<string, string> = {
  ...g2BuiltinSources,
  "primitive-contract.mjs": contract,
  "sdk.tsx": sdk,
  "GestureBoundary.tsx": gestureBoundary,
  "Primitives.tsx": primitives,
  "TableAlignment.tsx": tableAlignment,
  "table-hover.ts": tableHover,
  "Chart.tsx": chart,
  "Database.tsx": database,
  "Metrics.tsx": metrics,
  "Playground.tsx": playground,
  "Gallery.tsx": gallery,
  "Bookmark.tsx": bookmark,
  "shared.tsx": shared,
  "helpers.ts": helpers,
  "block.css": css,
  "Flowchart.tsx": flowchart,
  "flowchart.css": flowchartCss,
  "flowchart-contract.mjs": flowchartContract,
  "theme.css": `${themeTokens}\n${themeContent}`,
};
export const builtinExports: Record<string, string> = {
  ...g2Exports,
  text: "Markdown",
  image: "Image",
  table: "Table",
  callout: "Callout",
  toggle: "Toggle",
  divider: "Divider",
  code: "Code",
  chart: "Chart",
  flowchart: "Flowchart",
  database: "Database",
  metrics: "Metrics",
  playground: "Playground",
  gallery: "Gallery",
  bookmark: "Bookmark",
};

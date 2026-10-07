import { g2BuiltinSources } from "./g2-builtin-sources";
import g2Exports from "../components/blocks/g2/exports-map.json";
import themeTokens from "../design/tokens.css?raw";
import themeContent from "../design/content.css?raw";
import contract from "../components/blocks/primitive-contract.mjs?raw";
import sdk from "../components/blocks/sdk.tsx?raw";
import gestureBoundary from "../components/blocks/GestureBoundary.tsx?raw";
import viewportLock from "../components/blocks/ViewportLock.tsx?raw";
import viewportLockCss from "../components/blocks/viewport-lock.css?raw";
import tableHover from "../components/blocks/table-hover.ts?raw";
import tableAlignment from "../components/blocks/TableAlignment.tsx?raw";
import primitives from "../components/blocks/Primitives.tsx?raw";
import chart from "../components/blocks/Chart.tsx?raw";
import database from "../components/blocks/Database.tsx?raw";
import metrics from "../components/blocks/Metrics.tsx?raw";
import playground from "../components/blocks/Playground.tsx?raw";
import gallery from "../components/blocks/Gallery.tsx?raw";
import bookmark from "../components/blocks/Bookmark.tsx?raw";
import media from "../components/blocks/Media.tsx?raw";
import pdf from "../components/blocks/Pdf.tsx?raw";
import pdfEngine from "../components/blocks/pdf-engine.ts?raw";
import pdfAssets from "../components/blocks/pdf-assets.json?raw";
import references from "../components/blocks/References.tsx?raw";
import resourceEditor from "../components/blocks/ResourceEditor.tsx?raw";
import researchContract from "../components/blocks/research-contract.mjs?raw";
import researchCss from "../components/blocks/research-media.css?raw";
import math from "../components/blocks/markdown-math.mjs?raw";
import katexCss from "../components/blocks/katex.css?raw";
import shared from "../components/blocks/shared.tsx?raw";
import helpers from "../components/blocks/helpers.ts?raw";
import css from "../components/blocks/block.css?raw";
import flowchart from "../components/blocks/Flowchart.tsx?raw";
import flowchartCss from "../components/blocks/flowchart.css?raw";
import flowchartContract from "../components/blocks/flowchart-contract.mjs?raw";
import icons from "../ui/icons.ts?raw";
import expandableSearch from "../components/ExpandableSearch.tsx?raw";
import expandableSearchCss from "../components/expandable-search.css?raw";

const sources: Record<string, string> = {
  ...g2BuiltinSources,
  "icons.ts": icons,
  "ExpandableSearch.tsx": expandableSearch,
  "expandable-search.css": expandableSearchCss,
  "primitive-contract.mjs": contract,
  "sdk.tsx": sdk,
  "GestureBoundary.tsx": gestureBoundary,
  "ViewportLock.tsx": viewportLock,
  "viewport-lock.css": viewportLockCss,
  "Primitives.tsx": primitives,
  "TableAlignment.tsx": tableAlignment,
  "table-hover.ts": tableHover,
  "Chart.tsx": chart,
  "Database.tsx": database,
  "Metrics.tsx": metrics,
  "Playground.tsx": playground,
  "Gallery.tsx": gallery,
  "Bookmark.tsx": bookmark,
  "Media.tsx": media,
  "Pdf.tsx": pdf,
  "pdf-engine.ts": pdfEngine,
  "pdf-assets.json": pdfAssets,
  "References.tsx": references,
  "ResourceEditor.tsx": resourceEditor,
  "research-contract.mjs": researchContract,
  "research-media.css": researchCss,
  "markdown-math.mjs": math,
  "katex.css": katexCss,
  "shared.tsx": shared,
  "helpers.ts": helpers,
  "block.css": css,
  "Flowchart.tsx": flowchart,
  "flowchart.css": flowchartCss,
  "flowchart-contract.mjs": flowchartContract,
  "theme.css": `${themeTokens}\n${themeContent}`,
};
// Package the shared icon module inside the trusted SDK's virtual filesystem.
// User component packages retain the existing package-local import boundary.
export const builtinSources: Record<string, string> = Object.fromEntries(
  Object.entries(sources).map(([name, source]) => [
    name,
    source
      .replace(
        /from\s+["']\.\.\/ExpandableSearch["']/g,
        'from "./ExpandableSearch"',
      )
      .replace(/from\s+["'](?:\.\.\/){1,2}ui\/icons["']/g, 'from "./icons"'),
  ]),
);
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
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  references: "References",
};

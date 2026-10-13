import richTextTableAlignment from "../components/rich-text/table-alignment.ts?raw";
import richTextTableSelection from "../components/rich-text/table-selection.ts?raw";
import richTextExternalContent from "../components/rich-text/external-content.ts?raw";
import richTextWidgetSelection from "../components/rich-text/widget-selection.ts?raw";
import richTextDropCursor from "../components/rich-text/drop-cursor-cleanup.ts?raw";
import richTextInsertion from "../components/rich-text/component-insertion.ts?raw";
import richTextNodeViews from "../components/rich-text/NodeViews.tsx?raw";
import richTextComponent from "../components/rich-text/RichText.tsx?raw";
import richTextEditor from "../components/rich-text/RichTextEditor.tsx?raw";
import richTextView from "../components/rich-text/RichTextView.tsx?raw";
import richTextTableControls from "../components/rich-text/TableControls.tsx?raw";
import richTextTableActions from "../components/rich-text/TableSelectionActions.tsx?raw";
import richTextCss from "../components/rich-text/editor.css?raw";
import richTextEnvironment from "../components/rich-text/environment.tsx?raw";
import richTextExtensions from "../components/rich-text/extensions.ts?raw";
import richTextModel from "../components/rich-text/model.mjs?raw";
import richTextHighlight from "../components/rich-text/reading-highlight.ts?raw";
import sharedSelectionToolbar from "../editor/SelectionToolbar.tsx?raw";
import sharedSelectionToolbarCss from "../editor/selection-toolbar.css?raw";
import workspaceEditor from "../editor/workspace-editor.tsx?raw";
import editorNodeJson from "../editor/node-json.ts?raw";
import { g2BuiltinSources } from "./g2-builtin-sources";
import { diagramBuiltinSources } from "./diagram-builtin-sources";
import g2Exports from "../components/blocks/g2/exports-map.json";
import themeTokens from "../design/tokens.css?raw";
import themeContent from "../design/content.css?raw";
import contract from "../components/blocks/primitive-contract.mjs?raw";
import nativeInkContract from "../surface/native-ink.mjs?raw";
import nativeInkPreview from "../surface/NativeInkPreview.tsx?raw";
import nativeInkCss from "../surface/native-ink.css?raw";
import capacity from "../portable/capacity.mjs?raw";
import sdk from "../components/blocks/sdk.tsx?raw";
import actionHost from "../components/blocks/action-host.tsx?raw";
import gestureBoundary from "../components/blocks/GestureBoundary.tsx?raw";
import viewportLock from "../components/blocks/ViewportLock.tsx?raw";
import viewportLockCss from "../components/blocks/viewport-lock.css?raw";
import tableHover from "../components/blocks/table-hover.ts?raw";
import tableAlignment from "../components/blocks/TableAlignment.tsx?raw";
import primitives from "../components/blocks/Primitives.tsx?raw";
import presentation from "../components/blocks/Presentation.tsx?raw";
import presentationCss from "../components/blocks/presentation.css?raw";
import presentationContract from "../components/blocks/presentation-contract.mjs?raw";
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
import mindmap from "../components/blocks/Mindmap.tsx?raw";
import mindmapCss from "../components/blocks/mindmap.css?raw";
import mindmapContract from "../components/blocks/mindmap-contract.mjs?raw";
import selectionToolbar from "../editor/SelectionToolbar.tsx?raw";
import selectionToolbarCss from "../editor/selection-toolbar.css?raw";
import flowchart from "../components/blocks/Flowchart.tsx?raw";
import flowchartCss from "../components/blocks/flowchart.css?raw";
import flowchartContract from "../components/blocks/flowchart-contract.mjs?raw";
import icons from "../ui/icons.ts?raw";
import expandableSearch from "../components/ExpandableSearch.tsx?raw";
import expandableSearchCss from "../components/expandable-search.css?raw";
import i18nCore from "../i18n/index.ts?raw";
import i18nReact from "../i18n/react.ts?raw";
import i18n_blockHelpers from "../i18n/messages/blockHelpers.ts?raw";
import i18n_blocks from "../i18n/messages/blocks.ts?raw";
import i18n_chart from "../i18n/messages/chart.ts?raw";
import i18n_common from "../i18n/messages/common.ts?raw";
import i18n_database from "../i18n/messages/database.ts?raw";
import i18n_diagram from "../i18n/messages/diagram.ts?raw";
import i18n_editor from "../i18n/messages/editor.ts?raw";
import i18n_flowchart from "../i18n/messages/flowchart.ts?raw";
import i18n_g2 from "../i18n/messages/g2.ts?raw";
import i18n_gallery from "../i18n/messages/gallery.ts?raw";
import i18n_media from "../i18n/messages/media.ts?raw";
import i18n_metrics from "../i18n/messages/metrics.ts?raw";
import i18n_mindmap from "../i18n/messages/mindmap.ts?raw";
import i18n_nativeInk from "../i18n/messages/nativeInk.ts?raw";
import i18n_pdf from "../i18n/messages/pdf.ts?raw";
import i18n_playground from "../i18n/messages/playground.ts?raw";
import i18n_presentation from "../i18n/messages/presentation.ts?raw";
import i18n_primitives from "../i18n/messages/primitives.ts?raw";
import i18n_references from "../i18n/messages/references.ts?raw";
import i18n_resourceEditor from "../i18n/messages/resourceEditor.ts?raw";
import i18n_richText from "../i18n/messages/richText.ts?raw";
import i18n_search from "../i18n/messages/search.ts?raw";

const sources: Record<string, string> = {
  ...g2BuiltinSources,
  ...diagramBuiltinSources,
  "rich-text/table-alignment.ts": richTextTableAlignment,
  "rich-text/table-selection.ts": richTextTableSelection,
  "rich-text/external-content.ts": richTextExternalContent,
  "rich-text/widget-selection.ts": richTextWidgetSelection,
  "rich-text/drop-cursor-cleanup.ts": richTextDropCursor,
  "rich-text/component-insertion.ts": richTextInsertion,
  "rich-text/NodeViews.tsx": richTextNodeViews,
  "rich-text/RichText.tsx": richTextComponent,
  "rich-text/RichTextEditor.tsx": richTextEditor,
  "rich-text/RichTextView.tsx": richTextView,
  "rich-text/TableControls.tsx": richTextTableControls,
  "rich-text/TableSelectionActions.tsx": richTextTableActions,
  "rich-text/editor.css": richTextCss,
  "rich-text/environment.tsx": richTextEnvironment,
  "rich-text/extensions.ts": richTextExtensions,
  "rich-text/model.mjs": richTextModel,
  "rich-text/reading-highlight.ts": richTextHighlight,
  "editor/SelectionToolbar.tsx": sharedSelectionToolbar,
  "editor/selection-toolbar.css": sharedSelectionToolbarCss,
  "editor/workspace-editor.tsx": workspaceEditor,
  "editor/node-json.ts": editorNodeJson,
  "icons.ts": icons,
  "ExpandableSearch.tsx": expandableSearch,
  "expandable-search.css": expandableSearchCss,
  "primitive-contract.mjs": contract,
  "native-ink.mjs": nativeInkContract,
  "NativeInkPreview.tsx": nativeInkPreview,
  "native-ink.css": nativeInkCss,
  "capacity.mjs": capacity,
  "sdk.tsx": sdk,
  "action-host.tsx": actionHost,
  "GestureBoundary.tsx": gestureBoundary,
  "ViewportLock.tsx": viewportLock,
  "viewport-lock.css": viewportLockCss,
  "Primitives.tsx": primitives,
  "TableAlignment.tsx": tableAlignment,
  "table-hover.ts": tableHover,
  "Presentation.tsx": presentation,
  "presentation.css": presentationCss,
  "presentation-contract.mjs": presentationContract,
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
  "Mindmap.tsx": mindmap,
  "mindmap.css": mindmapCss,
  "mindmap-contract.mjs": mindmapContract,
  "SelectionToolbar.tsx": selectionToolbar,
  "selection-toolbar.css": selectionToolbarCss,
  "Flowchart.tsx": flowchart,
  "flowchart.css": flowchartCss,
  "flowchart-contract.mjs": flowchartContract,
  "theme.css": `${themeTokens}\n${themeContent}`,
  // Built-in blocks read their catalogs from here; each compiled component
  // keeps its own copy of the i18n core, which starts in the host's language.
  "i18n/index.ts": i18nCore,
  "i18n/react.ts": i18nReact,
  "i18n/messages/blockHelpers.ts": i18n_blockHelpers,
  "i18n/messages/blocks.ts": i18n_blocks,
  "i18n/messages/chart.ts": i18n_chart,
  "i18n/messages/common.ts": i18n_common,
  "i18n/messages/database.ts": i18n_database,
  "i18n/messages/diagram.ts": i18n_diagram,
  "i18n/messages/editor.ts": i18n_editor,
  "i18n/messages/flowchart.ts": i18n_flowchart,
  "i18n/messages/g2.ts": i18n_g2,
  "i18n/messages/gallery.ts": i18n_gallery,
  "i18n/messages/media.ts": i18n_media,
  "i18n/messages/metrics.ts": i18n_metrics,
  "i18n/messages/mindmap.ts": i18n_mindmap,
  "i18n/messages/nativeInk.ts": i18n_nativeInk,
  "i18n/messages/pdf.ts": i18n_pdf,
  "i18n/messages/playground.ts": i18n_playground,
  "i18n/messages/presentation.ts": i18n_presentation,
  "i18n/messages/primitives.ts": i18n_primitives,
  "i18n/messages/references.ts": i18n_references,
  "i18n/messages/resourceEditor.ts": i18n_resourceEditor,
  "i18n/messages/richText.ts": i18n_richText,
  "i18n/messages/search.ts": i18n_search,
};
// Package the shared icon module inside the trusted SDK's virtual filesystem.
// User component packages retain the existing package-local import boundary.
export const builtinSources: Record<string, string> = Object.fromEntries(
  Object.entries(sources).map(([name, source]) => [
    name,
    source
      .replaceAll('"../../surface/native-ink.mjs"', '"./native-ink.mjs"')
      .replaceAll('"../../surface/NativeInkPreview"', '"./NativeInkPreview"')
      .replaceAll('"../portable/capacity.mjs"', '"./capacity.mjs"')
      .replaceAll(
        '"../../portable/capacity.mjs"',
        name.startsWith("rich-text/")
          ? '"../capacity.mjs"'
          : '"./capacity.mjs"',
      )
      .replaceAll('"../rich-text/', '"./rich-text/')
      .replaceAll(
        '"../../editor/',
        name.startsWith("rich-text/") ? '"../editor/' : '"./editor/',
      )
      .replaceAll('"../blocks/', '"../')
      .replaceAll("'../blocks/", "'../")
      .replaceAll(
        '"../../ui/icons"',
        name.startsWith("rich-text/") ? '"../icons"' : '"./icons"',
      )
      .replace(
        /from\s+["']\.\.\/\.\.\/editor\/SelectionToolbar["']/g,
        'from "./SelectionToolbar"',
      )
      .replace(
        /from\s+["']\.\.\/ExpandableSearch["']/g,
        name.includes("/")
          ? 'from "../ExpandableSearch"'
          : 'from "./ExpandableSearch"',
      )
      .replace(/from\s+["'](?:\.\.\/){1,2}ui\/icons["']/g, 'from "./icons"')
      .replace(
        /(from\s+["'])(?:\.\.\/)+i18n(?=["'/])/g,
        `$1${"../".repeat(name.split("/").length - 1) || "./"}i18n`,
      ),
  ]),
);
export const builtinExports: Record<string, string> = {
  ...g2Exports,
  text: "RichText",
  image: "Image",
  table: "Table",
  callout: "Callout",
  toggle: "Toggle",
  divider: "Divider",
  code: "Code",
  "mechanism-steps": "MechanismSteps",
  "evidence-explorer": "EvidenceExplorer",
  chart: "Chart",
  mindmap: "Mindmap",
  flowchart: "Flowchart",
  archify: "Archify",
  "diagram-design": "DiagramDesign",
  "fireworks-tech-graph": "FireworksTechGraph",
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

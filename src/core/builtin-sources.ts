import richTextImageContent from "../components/rich-text/ImageContent.tsx?raw";
import richTextContentActions from "../components/rich-text/ContentNodeActions.tsx?raw";
import richTextTableAlignment from "../components/rich-text/table-alignment.ts?raw";
import richTextTableSelection from "../components/rich-text/table-selection.ts?raw";
import richTextExternalContent from "../components/rich-text/external-content.ts?raw";
import richTextWidgetSelection from "../components/rich-text/widget-selection.ts?raw";
import richTextAssistantSelection from "../components/rich-text/assistant-selection.ts?raw";
import richTextRangeEdit from "../components/rich-text/text-range-edit.ts?raw";
import textSelectionModel from "../surface/text-selection-model.ts?raw";
import selectionBridge from "../components/custom/selection-bridge.ts?raw";
import selectionFrame from "../components/custom/useSelectionFrame.ts?raw";
import textSelection from "../surface/text-selection.ts?raw";
import richTextDropCursor from "../components/rich-text/drop-cursor-cleanup.ts?raw";
import richTextInsertion from "../components/rich-text/component-insertion.ts?raw";
import richTextNodeViews from "../components/rich-text/NodeViews.tsx?raw";
import richTextComponent from "../components/rich-text/RichText.tsx?raw";
import richTextEditor from "../components/rich-text/RichTextEditor.tsx?raw";
import retainedEditorContent from "../components/rich-text/RetainedEditorContent.tsx?raw";
import richTextFormatControls from "../components/rich-text/FormatControls.tsx?raw";
import richTextFormatCss from "../components/rich-text/format-controls.css?raw";
import richTextView from "../components/rich-text/RichTextView.tsx?raw";
import highlightedCode from "../components/rich-text/HighlightedCode.tsx?raw";
import codeHighlighting from "../components/rich-text/code-highlighting.ts?raw";
import codeHighlightingCss from "../components/rich-text/code-highlighting.css?raw";
import codeBlock from "../components/rich-text/code-block.ts?raw";
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
import comparisonMatrix from "../components/blocks/ComparisonMatrix.tsx?raw";
import statusTree from "../components/blocks/StatusTree.tsx?raw";
import experimentTracker from "../components/blocks/ExperimentTracker.tsx?raw";
import analysisCss from "../components/blocks/analysis.css?raw";
import analysisContract from "../components/blocks/analysis-contract.mjs?raw";
import scene3d from "../components/blocks/Scene3D.tsx?raw";
import scene3dCss from "../components/blocks/scene3d.css?raw";
import scene3dContract from "../components/blocks/scene3d-contract.mjs?raw";
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
import i18n_primitives from "../i18n/messages/primitives.ts?raw";
import i18n_references from "../i18n/messages/references.ts?raw";
import i18n_resourceEditor from "../i18n/messages/resourceEditor.ts?raw";
import i18n_richText from "../i18n/messages/richText.ts?raw";
import i18n_search from "../i18n/messages/search.ts?raw";
import i18n_analysis from "../i18n/messages/analysis.ts?raw";
import i18n_scene3d from "../i18n/messages/scene3d.ts?raw";
import src_InlineMarkup_tsx from "../components/blocks/InlineMarkup.tsx?raw";
import src_inline_markup_mjs from "../components/blocks/inline-markup.mjs?raw";
import src_database_contract_mjs from "../components/blocks/database-contract.mjs?raw";
import src_database_calendar_css from "../components/blocks/database-calendar.css?raw";
import src_DatabaseCalendar_tsx from "../components/blocks/DatabaseCalendar.tsx?raw";
import src_playground_contract_mjs from "../components/blocks/playground-contract.mjs?raw";
import src_playground_css from "../components/blocks/playground.css?raw";
import src_i18n_messages_eventTimeline_ts from "../i18n/messages/eventTimeline.ts?raw";
import src_event_timeline_contract_mjs from "../components/blocks/event-timeline-contract.mjs?raw";
import src_event_timeline_css from "../components/blocks/event-timeline.css?raw";
import src_EventTimeline_tsx from "../components/blocks/EventTimeline.tsx?raw";
import src_i18n_messages_waterfall_ts from "../i18n/messages/waterfall.ts?raw";
import src_waterfall_css from "../components/blocks/waterfall.css?raw";
import src_Waterfall_tsx from "../components/blocks/Waterfall.tsx?raw";
import src_i18n_messages_roadmap_ts from "../i18n/messages/roadmap.ts?raw";
import src_plan_contract_mjs from "../components/blocks/plan-contract.mjs?raw";
import src_roadmap_css from "../components/blocks/roadmap.css?raw";
import src_Roadmap_tsx from "../components/blocks/Roadmap.tsx?raw";
import src_i18n_messages_cardGrid_ts from "../i18n/messages/cardGrid.ts?raw";
import src_card_grid_css from "../components/blocks/card-grid.css?raw";
import src_CardGrid_tsx from "../components/blocks/CardGrid.tsx?raw";
import src_i18n_messages_structureBrowser_ts from "../i18n/messages/structureBrowser.ts?raw";
import src_doc_browse_contract_mjs from "../components/blocks/doc-browse-contract.mjs?raw";
import src_structure_browser_css from "../components/blocks/structure-browser.css?raw";
import src_StructureBrowser_tsx from "../components/blocks/StructureBrowser.tsx?raw";
import src_i18n_messages_commandReference_ts from "../i18n/messages/commandReference.ts?raw";
import src_command_reference_css from "../components/blocks/command-reference.css?raw";
import src_CommandReference_tsx from "../components/blocks/CommandReference.tsx?raw";
import src_i18n_messages_stepGuide_ts from "../i18n/messages/stepGuide.ts?raw";
import src_step_guide_css from "../components/blocks/step-guide.css?raw";
import src_StepGuide_tsx from "../components/blocks/StepGuide.tsx?raw";
import src_doc_reference_contract_mjs from "../components/blocks/doc-reference-contract.mjs?raw";
import src_i18n_messages_layerDiagram_ts from "../i18n/messages/layerDiagram.ts?raw";
import src_layer_diagram_css from "../components/blocks/layer-diagram.css?raw";
import src_LayerDiagram_tsx from "../components/blocks/LayerDiagram.tsx?raw";
import src_step_walkthrough_css from "../components/blocks/step-walkthrough.css?raw";
import src_StepWalkthrough_tsx from "../components/blocks/StepWalkthrough.tsx?raw";
import src_walkthrough_contract from "../components/blocks/walkthrough-contract.mjs?raw";
import i18n_stepWalkthrough from "../i18n/messages/stepWalkthrough.ts?raw";
import src_i18n_messages_sequenceDiagram_ts from "../i18n/messages/sequenceDiagram.ts?raw";
import src_doc_diagrams_contract_mjs from "../components/blocks/doc-diagrams-contract.mjs?raw";
import src_sequence_diagram_css from "../components/blocks/sequence-diagram.css?raw";
import src_SequenceDiagram_tsx from "../components/blocks/SequenceDiagram.tsx?raw";

const sources: Record<string, string> = {
  ...g2BuiltinSources,
  ...diagramBuiltinSources,
  "rich-text/ImageContent.tsx": richTextImageContent,
  "rich-text/ContentNodeActions.tsx": richTextContentActions,
  "rich-text/table-alignment.ts": richTextTableAlignment,
  "rich-text/table-selection.ts": richTextTableSelection,
  "rich-text/external-content.ts": richTextExternalContent,
  "rich-text/widget-selection.ts": richTextWidgetSelection,
  "rich-text/assistant-selection.ts": richTextAssistantSelection,
  "rich-text/text-range-edit.ts": richTextRangeEdit,
  "surface/text-selection-model.ts": textSelectionModel,
  "custom/selection-bridge.ts": selectionBridge,
  "custom/useSelectionFrame.ts": selectionFrame,
  "surface/text-selection.ts": textSelection,
  "rich-text/drop-cursor-cleanup.ts": richTextDropCursor,
  "rich-text/component-insertion.ts": richTextInsertion,
  "rich-text/NodeViews.tsx": richTextNodeViews,
  "rich-text/RichText.tsx": richTextComponent,
  "rich-text/RichTextEditor.tsx": richTextEditor,
  "rich-text/RetainedEditorContent.tsx": retainedEditorContent,
  "rich-text/FormatControls.tsx": richTextFormatControls,
  "rich-text/format-controls.css": richTextFormatCss,
  "rich-text/RichTextView.tsx": richTextView,
  "rich-text/HighlightedCode.tsx": highlightedCode,
  "rich-text/code-highlighting.ts": codeHighlighting,
  "rich-text/code-highlighting.css": codeHighlightingCss,
  "rich-text/code-block.ts": codeBlock,
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
  "ComparisonMatrix.tsx": comparisonMatrix,
  "StatusTree.tsx": statusTree,
  "ExperimentTracker.tsx": experimentTracker,
  "analysis.css": analysisCss,
  "analysis-contract.mjs": analysisContract,
  "Scene3D.tsx": scene3d,
  "scene3d.css": scene3dCss,
  "scene3d-contract.mjs": scene3dContract,
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
  "i18n/messages/primitives.ts": i18n_primitives,
  "i18n/messages/references.ts": i18n_references,
  "i18n/messages/resourceEditor.ts": i18n_resourceEditor,
  "i18n/messages/richText.ts": i18n_richText,
  "i18n/messages/search.ts": i18n_search,
  "i18n/messages/analysis.ts": i18n_analysis,
  "i18n/messages/scene3d.ts": i18n_scene3d,
  "InlineMarkup.tsx": src_InlineMarkup_tsx,
  "inline-markup.mjs": src_inline_markup_mjs,
  "database-contract.mjs": src_database_contract_mjs,
  "database-calendar.css": src_database_calendar_css,
  "DatabaseCalendar.tsx": src_DatabaseCalendar_tsx,
  "playground-contract.mjs": src_playground_contract_mjs,
  "playground.css": src_playground_css,
  "i18n/messages/eventTimeline.ts": src_i18n_messages_eventTimeline_ts,
  "event-timeline-contract.mjs": src_event_timeline_contract_mjs,
  "event-timeline.css": src_event_timeline_css,
  "EventTimeline.tsx": src_EventTimeline_tsx,
  "i18n/messages/waterfall.ts": src_i18n_messages_waterfall_ts,
  "waterfall.css": src_waterfall_css,
  "Waterfall.tsx": src_Waterfall_tsx,
  "i18n/messages/roadmap.ts": src_i18n_messages_roadmap_ts,
  "plan-contract.mjs": src_plan_contract_mjs,
  "roadmap.css": src_roadmap_css,
  "Roadmap.tsx": src_Roadmap_tsx,
  "i18n/messages/cardGrid.ts": src_i18n_messages_cardGrid_ts,
  "card-grid.css": src_card_grid_css,
  "CardGrid.tsx": src_CardGrid_tsx,
  "i18n/messages/structureBrowser.ts": src_i18n_messages_structureBrowser_ts,
  "doc-browse-contract.mjs": src_doc_browse_contract_mjs,
  "structure-browser.css": src_structure_browser_css,
  "StructureBrowser.tsx": src_StructureBrowser_tsx,
  "i18n/messages/commandReference.ts": src_i18n_messages_commandReference_ts,
  "command-reference.css": src_command_reference_css,
  "CommandReference.tsx": src_CommandReference_tsx,
  "i18n/messages/stepGuide.ts": src_i18n_messages_stepGuide_ts,
  "step-guide.css": src_step_guide_css,
  "StepGuide.tsx": src_StepGuide_tsx,
  "doc-reference-contract.mjs": src_doc_reference_contract_mjs,
  "i18n/messages/layerDiagram.ts": src_i18n_messages_layerDiagram_ts,
  "layer-diagram.css": src_layer_diagram_css,
  "LayerDiagram.tsx": src_LayerDiagram_tsx,
  "step-walkthrough.css": src_step_walkthrough_css,
  "StepWalkthrough.tsx": src_StepWalkthrough_tsx,
  "walkthrough-contract.mjs": src_walkthrough_contract,
  "i18n/messages/stepWalkthrough.ts": i18n_stepWalkthrough,
  "i18n/messages/sequenceDiagram.ts": src_i18n_messages_sequenceDiagram_ts,
  "doc-diagrams-contract.mjs": src_doc_diagrams_contract_mjs,
  "sequence-diagram.css": src_sequence_diagram_css,
  "SequenceDiagram.tsx": src_SequenceDiagram_tsx,
};
// Package shared modules and rewrite their imports inside the trusted SDK's virtual filesystem.
// User component packages retain the existing package-local import boundary.
export const builtinSources: Record<string, string> = Object.fromEntries(
  Object.entries(sources).map(([name, source]) => [
    name,
    source
      .replaceAll('"../../surface/native-ink.mjs"', '"./native-ink.mjs"')
      .replaceAll(
        '"../../surface/NativeInkPreview"',
        name.startsWith("rich-text/")
          ? '"../NativeInkPreview"'
          : '"./NativeInkPreview"',
      )
      .replaceAll('"../portable/capacity.mjs"', '"./capacity.mjs"')
      .replaceAll(
        '"../../portable/capacity.mjs"',
        name.startsWith("rich-text/")
          ? '"../capacity.mjs"'
          : '"./capacity.mjs"',
      )
      .replaceAll('"../rich-text/', '"./rich-text/')
      .replaceAll('"../custom/selection-bridge"', '"./custom/selection-bridge"')
      .replaceAll(
        '"../custom/useSelectionFrame"',
        '"./custom/useSelectionFrame"',
      )
      .replaceAll(
        '"../../surface/text-selection-model"',
        '"../surface/text-selection-model"',
      )
      .replaceAll(
        '"../components/rich-text/text-range-edit"',
        '"../rich-text/text-range-edit"',
      )
      .replaceAll(
        '"../../surface/text-selection"',
        name.includes("/")
          ? '"../surface/text-selection"'
          : '"./surface/text-selection"',
      )
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
  "step-walkthrough": "StepWalkthrough",
  "comparison-matrix": "ComparisonMatrix",
  "status-tree": "StatusTree",
  "experiment-tracker": "ExperimentTracker",
  "scene-3d": "Scene3D",
  "event-timeline": "EventTimeline",
  waterfall: "Waterfall",
  roadmap: "Roadmap",
  "card-grid": "CardGrid",
  "structure-browser": "StructureBrowser",
  "command-reference": "CommandReference",
  "step-guide": "StepGuide",
  "layer-diagram": "LayerDiagram",
  "sequence-diagram": "SequenceDiagram",
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

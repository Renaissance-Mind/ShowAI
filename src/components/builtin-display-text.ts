import type { BuiltinDisplayText } from "./component-display";

/** English names and descriptions of built-in components, keyed by kind. */
export const builtinEnglish: BuiltinDisplayText = {
  text: {
    name: "Rich text",
    description:
      "One rich text component for both app input and AI writing: headings, lists, tables, formulas, fonts, sizes, colors, underline, highlight and paragraph alignment, with built-in selection, hover and table menus. Imports Markdown and plain text.",
  },
  image: {
    name: "Image",
    description:
      "A single image with a caption. Adjust its size, crop and corner radius. Offline pages embed the image.",
  },
  table: {
    name: "Basic table",
    description:
      "A lightweight two-dimensional table of text, numbers and booleans, with editable headers and cells and per-column or whole-table alignment.",
  },
  callout: {
    name: "Callout",
    description: "A tip, quote or note with a title and Markdown body.",
  },
  toggle: {
    name: "Toggle",
    description:
      "Supplementary content that expands on demand. The body supports rich text and Markdown import.",
  },
  divider: {
    name: "Divider",
    description: "A light visual separator between page content.",
  },
  code: {
    name: "Code block",
    description:
      "A code snippet that keeps indentation and line breaks, with a declared language and custom appearance.",
  },
  chart: {
    name: "Data chart",
    description: "Interactive line and bar charts with expandable raw data.",
  },
  database: {
    name: "Database",
    description:
      "A table with filters, sorting and a board view. Cells hold text, numbers, selects, checkboxes and links.",
  },
  metrics: {
    name: "Key metrics",
    description: "Sourced values with units, changes and notes.",
  },
  playground: {
    name: "Interactive calculator",
    description: "Explore sums, products or averages with sliders.",
  },
  gallery: {
    name: "Image gallery",
    description:
      "A collection of captioned images. Offline exports embed PNG, JPEG, GIF, WebP or AVIF.",
  },
  bookmark: {
    name: "Source bookmark",
    description:
      "A link to an external source with a title, description and optional thumbnail.",
  },
  mindmap: {
    name: "Mind map",
    description:
      "Branches balance naturally around a central topic, or use a one-sided layout. Supports keyboard editing, collapsing and undo.",
  },
  flowchart: {
    name: "Interactive flowchart",
    description:
      "A zoomable flowchart built on React Flow, with node details, branches, multiple flows and node editing.",
  },
  video: {
    name: "Video",
    description:
      "A video player that keeps the aspect ratio, with local upload, online files, a cover image and a caption.",
  },
  audio: {
    name: "Audio",
    description:
      "A compact audio player with local upload, online files and a caption.",
  },
  pdf: {
    name: "PDF document",
    description:
      "A built-in PDF reader with paging, zoom, a start page, page text and download.",
  },
  references: {
    name: "References",
    description:
      "Numbered references with authors, year, title, source, DOI, link and notes, cited by anchors in the text.",
  },
  "mechanism-steps": {
    name: "Mechanism steps",
    description:
      "Keep objects in place and compare step by step what changes, what stays and how the change propagates.",
  },
  "evidence-explorer": {
    name: "Evidence explorer",
    description:
      "Survey evidence by topic and time, with linked item details and comparisons across shared dimensions, keeping conditions and sources.",
  },
  "g2-bar": {
    name: "Column chart",
    description: "Compare values across categories.",
  },
  "g2-line": {
    name: "Line chart",
    description: "Follow continuous change and trends.",
  },
  "g2-area": {
    name: "Area chart",
    description: "Emphasize trends with filled areas.",
  },
  "g2-scatter-plot": {
    name: "Scatter plot",
    description: "See relationships between variables and outliers.",
  },
  "g2-bubble-chart": {
    name: "Bubble chart",
    description: "Add a value dimension with bubble size.",
  },
  "g2-multi-set-bar": {
    name: "Grouped column chart",
    description: "Compare series side by side.",
  },
  "g2-bi-directional-bar": {
    name: "Diverging bar chart",
    description:
      "Compare positive and negative values or two groups in opposite directions.",
  },
  "g2-radar-chart": {
    name: "Radar chart",
    description: "Compare profiles across several dimensions.",
  },
  "g2-radial-bar": {
    name: "Radial bar chart",
    description: "Arrange bars in polar coordinates.",
  },
  "g2-parallel": {
    name: "Parallel coordinates",
    description: "See patterns across many numeric dimensions.",
  },
  "g2-regressioncurve": {
    name: "Regression curve",
    description: "Overlay a fitted trend on a scatter plot.",
  },
  "g2-pie": {
    name: "Pie chart",
    description: "Show category shares of a whole.",
  },
  "g2-donut-chart": {
    name: "Donut chart",
    description: "Show proportions with an open center.",
  },
  "g2-stacked-bar": {
    name: "Stacked column chart",
    description: "Compare totals and their parts.",
  },
  "g2-stacked-area": {
    name: "Stacked area chart",
    description: "See how composition changes over time.",
  },
  "g2-rose": {
    name: "Rose chart",
    description: "Show differences by sector radius.",
  },
  "g2-mosaic": {
    name: "Mosaic chart",
    description: "Show categorical composition by width and area.",
  },
  "g2-treemap": {
    name: "Treemap",
    description: "Show hierarchy and shares with nested rectangles.",
  },
  "g2-sunburst": {
    name: "Sunburst chart",
    description: "Unfold composition in concentric levels.",
  },
  "g2-funnel": {
    name: "Funnel chart",
    description: "Show how counts change across stages.",
  },
  "g2-histogram": {
    name: "Histogram",
    description: "Bin values to see their frequency.",
  },
  "g2-boxplot": {
    name: "Box plot",
    description: "Show quartiles and outliers.",
  },
  "g2-violin": {
    name: "Violin plot",
    description: "Combine density with a distribution summary.",
  },
  "g2-distributioncurve": {
    name: "Distribution curve",
    description: "See the shape of a continuous probability or density.",
  },
  "g2-heatmap": {
    name: "Density heatmap",
    description: "Find hot spots in two-dimensional space.",
  },
  "g2-color-map": {
    name: "Color grid",
    description: "Encode grid values with color.",
  },
  "g2-contourline": {
    name: "Contour chart",
    description: "Show a continuous field with contour lines.",
  },
  "g2-stem-leaf": {
    name: "Stem-and-leaf plot",
    description: "Show a distribution while keeping each value.",
  },
  "g2-sankey": {
    name: "Sankey diagram",
    description: "Show flow volume with link width.",
  },
  "g2-chord": {
    name: "Chord diagram",
    description: "Show relationship strength inside a circle.",
  },
  "g2-arcdiagram": {
    name: "Arc diagram",
    description: "Connect nodes on a line with arcs.",
  },
  "g2-pack": {
    name: "Circle packing",
    description: "Show hierarchy through containment.",
  },
  "g2-venn": {
    name: "Venn diagram",
    description: "Show sets and their intersections.",
  },
  "g2-gantt": {
    name: "Gantt chart",
    description: "Show when tasks start and end.",
  },
  "g2-k-chart": {
    name: "Candlestick chart",
    description: "Show open, close, high and low values.",
  },
  "g2-kagi": {
    name: "Kagi chart",
    description: "Draw vertical lines and line weights from price reversals.",
  },
  "g2-spiral": {
    name: "Spiral chart",
    description: "Lay out a continuous series on spiral coordinates.",
  },
  "g2-choropleth-map": {
    name: "Choropleth map",
    description: "Color regions by value.",
  },
  "g2-dot-map": {
    name: "Dot map",
    description: "Mark real locations on a map.",
  },
  "g2-bubble-map": {
    name: "Bubble map",
    description: "Show geographic values with circle size.",
  },
  "g2-gauge": {
    name: "Gauge",
    description: "Show progress or a metric on an arc.",
  },
  "g2-bullet": {
    name: "Bullet chart",
    description: "Show actual, target and ranges together.",
  },
  "g2-wordcloud": {
    name: "Word cloud",
    description: "Show word weight with font size.",
  },
  archify: {
    name: "Archify interactive diagram",
    description:
      "Workflow, system architecture, sequence, data flow and lifecycle diagrams in Archify's native HTML/SVG reader, with node search, path exploration, themes and export.",
  },
  "diagram-design": {
    name: "Diagram Design graphic",
    description:
      "45 Diagram Design templates that keep the original HTML/SVG layout and styling, covering architecture, flows, relationships and data. Edit the text or the graphic source.",
  },
  "fireworks-tech-graph": {
    name: "Fireworks tech graph",
    description:
      "12 Fireworks Tech Graph styles that keep the original SVG and semantic links, with text editing, full SVG/HTML import and offline export.",
  },
  page: {
    name: "Page",
    description:
      "Arrange text, images and components in order. Embed it in a page or board, or expand it to edit.",
  },
  board: {
    name: "Board",
    description:
      "Place components and drawings in a free space. Embed it in a page or another board.",
  },
};

// G2 charts all share the same editing capabilities.
const g2Suffix = " Edit the data, theme and interactions.";
for (const [kind, text] of Object.entries(builtinEnglish))
  if (kind.startsWith("g2-")) text.description += g2Suffix;

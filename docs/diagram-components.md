# Diagram components

**Language:** English | [简体中文](i18n/diagram-components.zh-CN.md) · [Documentation](README.md)

ShowAI includes three diagram families in the Flow component category. Insert them through `/` in Page or Board, or use `component.insert` with their built-in `kind`.

| Kind                   | Templates                                                                                                 | Original project                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `archify`              | 10 types: workflow, architecture, sequence, dataflow, lifecycle, ERD, class, tree, timeline and waterfall | [Archify](https://github.com/tt-a1i/archify)                                   |
| `diagram-design`       | 45 editorial diagram types                                                                                | [Diagram Design](https://github.com/cathrynlavery/diagram-design)              |
| `fireworks-tech-graph` | 12 technical diagram styles                                                                               | [Fireworks Tech Graph](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) |

Each component displays the original SVG or HTML. Archify retains its interactive reader, including node search, path exploration, visual presets and export. Diagram Design retains its editorial layout and CSS. Fireworks retains its original SVG geometry and semantic connections. The included templates are editable examples; use the task's own facts when making a document.

## Input and editing

`template` selects a built-in example. `source`, when provided, replaces that example with a complete SVG or an HTML document containing SVG. Set `template: "custom"` when importing a new result. `title` and `description` are optional captions outside the imported diagram. `height` sets the reader area from 240 to 1200 px and defaults to 560 px.

Select the component and open its existing settings menu to choose a template, edit SVG text, import an HTML/SVG file, or edit the complete source. Text changes preserve the original geometry. Longer labels may need a corresponding layout change in the source. Saving checks the current instance against the editor's starting version and keeps the draft when another change has arrived.

New diagrams use a compact presentation: titles and subtitles sit outside the graphic, while supplementary explanations are hidden. The existing settings menu can put each caption inside, outside or hide it, keep notes inline or move them to a disclosure, and toggle marked legends and reading controls. `presentation` stores these choices. Omitting it preserves the complete original presentation for older instances. Display choices preserve `source`; switching to Original restores the full graphic. Custom imports need identifiable caption/legend markup for these controls to apply.

Agent discovery uses the normal component catalog. Read the usage guide and parameters first. In the source view, `file: "diagram-templates.json"` returns the templates' full SVG/HTML, their upstream source paths, exact commits, licenses and drawing references. The default component source imports `Archify`, `DiagramDesign` or `FireworksTechGraph` from `showai:components`; derived components can reuse the same offline implementation.

## Original production workflow

The component's usage guide contains an Original authoring guides section. It includes the full upstream process, shared primitives, visual and layout rules, type/style instructions and quality checks. Every guide records its original path, commit, URL and SHA-256. Derived source packages carry these files and validate their references and guide hashes when saved.

For Agents, `catalog_describe` with `view: "guide"` returns `authoringReference`. Follow that exact scoped reference to `authoring/index.json`, then read the selected guide files through the source view. `authoring/schemas.json`, `authoring/examples.json` and `diagram-templates.json` provide the original inputs and examples. The kit contains the complete production source and assets at the recorded upstream revision, including Diagram Design's alternate templates and production checks.

Save `authoring/kit.json`, `authoring/run.mjs`, `authoring/diagram-authoring-fonts.mjs` and `authoring/font-licenses.json` together. The index lists the commands. Archify's ten JSON types execute the unchanged Node renderers; Fireworks' eleven generated styles execute its unchanged Python generator. The runner writes a separate output, preserves the input and returns `data` ready for the ShowAI component. Choose a new work directory for extraction. The originals and their licenses remain in that directory for inspection and upstream checks. Browser review uses the host's supported browser tools.

Diagram Design and Fireworks style 8 are authored SVG/HTML workflows. Follow their full original guides, then import the resulting artifact. The same authored source produces the same geometry; independent free-form Agent drawings can vary. Choose Original presentation when comparing with the upstream output. `--embed-fonts` downloads the original public font families and embeds locally selected glyph subsets for offline rendering. Font requests contain no document text. The bundled Diagram Design examples already contain offline copies of their original fonts.

## Reading and export

The diagram begins locked so page scrolling and component selection remain available. Unlock it to use its internal reading controls. Reading choices affect the current view; they do not overwrite the saved source. Read-only pages hide the ShowAI editing and import controls.

Download SVG for the displayed graphic with its embedded CSS, or download HTML to retain the reader and any external captions or collapsed notes. Choose Original before exporting to retain all original captions and explanations. Both include the upstream license notices. Templates and their resources are bundled locally. Imported diagrams should embed their fonts, images and icons; external requests are disabled in the reader's isolated frame.

All three upstream projects use MIT licenses. Exact revisions and full notices, including Archify's embedded font notice, are recorded in `src/components/blocks/diagrams/licenses.json`.

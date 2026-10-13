# Diagram components

ShowAI includes three diagram families in the Flow component category. Insert them through `/` in Page or Board, or use `component.insert` with their built-in `kind`.

| Kind | Templates | Original project |
| --- | --- | --- |
| `archify` | Workflow, architecture, sequence, dataflow and lifecycle | [Archify](https://github.com/tt-a1i/archify) |
| `diagram-design` | 45 editorial diagram types | [Diagram Design](https://github.com/cathrynlavery/diagram-design) |
| `fireworks-tech-graph` | 12 technical diagram styles | [Fireworks Tech Graph](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) |

Each component displays the original SVG or HTML. Archify retains its interactive reader, including node search, path exploration, visual presets and export. Diagram Design retains its editorial layout and CSS. Fireworks retains its original SVG geometry and semantic connections. The included templates are editable examples; use the task's own facts when making a document.

## Input and editing

`template` selects a built-in example. `source`, when provided, replaces that example with a complete SVG or an HTML document containing SVG. Set `template: "custom"` when importing a new result. `title` and `description` are optional captions outside the imported diagram. `height` sets the reader area from 240 to 1200 px and defaults to 560 px.

Select the component and open its existing settings menu to choose a template, edit SVG text, import an HTML/SVG file, or edit the complete source. Text changes preserve the original geometry. Longer labels may need a corresponding layout change in the source. Saving checks the current instance against the editor's starting version and keeps the draft when another change has arrived.

Agent discovery uses the normal component catalog. Read the usage guide and parameters first. In the source view, `file: "diagram-templates.json"` returns the templates' full SVG/HTML, their upstream source paths, exact commits, licenses and drawing references. The default component source imports `Archify`, `DiagramDesign` or `FireworksTechGraph` from `showai:components`; derived components can reuse the same offline implementation.

Archify and Fireworks JSON inputs are authoring inputs for their original renderers. Render them to SVG/HTML before importing into ShowAI. Natural language generation follows the original project's authoring workflow; the ShowAI component displays and edits the resulting artifact.

## Reading and export

The diagram begins locked so page scrolling and component selection remain available. Unlock it to use its internal reading controls. Reading choices affect the current view; they do not overwrite the saved source. Read-only pages hide the ShowAI editing and import controls.

Download SVG for the saved graphic with its embedded CSS, or download HTML to retain the original reader. Both include the upstream license notices. Templates and their resources are bundled locally. Imported diagrams should embed their fonts, images and icons; external requests are disabled in the reader's isolated frame.

All three upstream projects use MIT licenses. Exact revisions and full notices, including Archify's embedded font notice, are recorded in `src/components/blocks/diagrams/licenses.json`.

# ShowAI artifact format, version 1

A `.showai.json` file describes one interactive page. The rendered `.html` contains that source, the React reader, styles, and interactive block components. It opens directly in a browser without a server. The visible surface is the page title and content; a small corner menu provides source download, appearance, and print. Reader interactions are temporary; edit the source or open it in the ShowAI canvas to save content changes.

## Envelope

```json
{
  "format": "showai",
  "version": 1,
  "document": {
    "id": "research-result",
    "title": "Research result",
    "content": {
      "type": "doc",
      "content": [
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "Start with the question." }]
        }
      ]
    }
  }
}
```

`id`, `title`, and a `doc` content node are required. `createdAt` and `updatedAt` use ISO date strings; missing dates use import time. Older sources may retain `icon`, `cover`, `parentId`, `favorite`, `archived`, and `comments` for compatibility. These fields do not add navigation, decorations, or comments to the rendered page. Import opens the source as the current canvas.

See [the complete example](../examples/welcome.showai.json), which pairs a mathematical chart with a two-input calculator. In the installed plugin the example is under `../examples/` relative to this reference.

## Text and document blocks

Content follows the editor's JSON tree. Every block uses `{type, attrs?, content?}`; text uses `{type: "text", text, marks?}`. Empty paragraphs use `content: []`; empty text nodes are invalid.

| Type                        | Content and attributes                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `paragraph`                 | Inline `text` and `hardBreak`; optional `textAlign`                                                       |
| `heading`                   | Inline content; `attrs.level` is 1, 2, or 3                                                               |
| `bulletList`, `orderedList` | `listItem` children; ordered list can set `attrs.start` and marker `attrs.type` (`1`, `a`, `A`, `i`, `I`) |
| `listItem`                  | Begins with a paragraph; further blocks and nested lists allowed                                          |
| `taskList`                  | `taskItem` children                                                                                       |
| `taskItem`                  | Begins with a paragraph; `attrs.checked` is boolean                                                       |
| `blockquote`                | One or more blocks                                                                                        |
| `codeBlock`                 | Plain text nodes, optional `attrs.language`                                                               |
| `horizontalRule`            | No content                                                                                                |
| `image`                     | No content; `attrs.src`, `alt`, `title`; optional numeric width/height                                    |
| `table`                     | One or more `tableRow` nodes                                                                              |
| `tableRow`                  | One or more `tableCell` or `tableHeader` nodes                                                            |
| `tableCell`, `tableHeader`  | One or more blocks; optional `colspan`, `rowspan`, `colwidth`, `align`                                    |
| `callout`                   | One or more blocks; `attrs.icon`, `attrs.tone` (`sage`, `sand`, `blue`, `rose`)                           |
| `toggle`                    | One or more blocks; `attrs.title`, `attrs.open`                                                           |
| `widget`                    | No content; `attrs.kind` and `attrs.data`                                                                 |

Text marks are `bold`, `italic`, `underline`, `strike`, `code`, `highlight`, and `link`. A link has `attrs.href` with an HTTP(S), `mailto:`, `tel:`, or anchor URL; a highlight can use `attrs.color`. JavaScript URLs and arbitrary HTML are rejected.

```json
{
  "type": "text",
  "text": "Official source",
  "marks": [{ "type": "link", "attrs": { "href": "https://react.dev/" } }]
}
```

## Interactive blocks

Every interactive block uses the same wrapper:

```json
{
  "type": "widget",
  "attrs": {
    "kind": "chart",
    "data": {
      "title": "A chart",
      "type": "line",
      "labels": ["0", "1", "2"],
      "series": [{ "name": "y = x²", "values": [0, 1, 4], "color": "#547c63" }]
    }
  }
}
```

The built-in data shapes below are plain JSON. Optional fields are marked with `?`; the notation describes a schema and is not literal JSON.

### Chart

```text
{ title, description?, type: "line" | "bar", labels: string[],
  series: { name, values: number[], color?: "#RRGGBB" }[], unit? }
```

Series values must be finite numbers and match the label count. Supports up to 500 labels and 20 series. Legends toggle series visibility; points/bars reveal values. Use verified numbers or clearly identified mathematical/scenario values.

### Database

```text
{ title,
  columns: { id, name, type: "text" | "number" | "select" | "checkbox" | "url", options?: string[] }[],
  rows: { id, [columnId]: string | number | boolean }[], groupBy?: columnId }
```

Column and row IDs must be unique within their list. Limits: 50 columns, 5,000 rows. Use a select column for `groupBy`. Readers can search, filter, sort, switch between table and board, and download CSV. The editor adds data/field editing. CSV export escapes formula-like text.

### Metrics

```text
{ title, items: { label, value: string | number, unit?, detail?, trend?: number }[] }
```

The optional numeric trend is displayed as a percentage. Maximum 100 items. Omit unknown measurements instead of inventing numbers.

### Playground

```text
{ title, description?,
  inputs: { id, label, min: number, max: number, step: number, value: number, unit? }[],
  operation: "sum" | "product" | "average", resultLabel, unit? }
```

Up to 30 inputs. Require `min < max`, `step > 0`, and an initial value within the range. Readers adjust sliders or number fields and reset their exploration. Calculations use the selected operation; arbitrary code/formulas are not executed.

### Gallery

```text
{ title, description?, columns: 1 | 2 | 3,
  images: { id, src, alt, caption }[] }
```

Up to 100 images with unique IDs. Use raster data URIs for portable images. Readers open a lightbox; captions and alt text should explain the image.

### Bookmark

```text
{ title, description, url, image? }
```

Use an HTTP(S) destination URL. Optional `image` follows the same rules as gallery images. Links open their destinations when clicked; link destinations are not copied into the offline file.

### Custom blocks

Register a React component in `src/components/blocks/registry.ts` and include it in both application and reader builds. Follow the registry's `BlockDefinition` and `BlockProps` contracts, with stable `kind`, `defaultData`, and a renderer. The serialized widget contains only data. Unknown kinds keep their data and display a readable fallback; importing JSON cannot install or execute a component.

A custom renderer must respect `readOnly` for persistent edits while allowing temporary exploration. Bundle its runtime assets, and declare any external images in `src/portable/assets.mjs` so offline export can embed them. Rebuild the viewer and plugin after registration.

## Export and offline behavior

Build the repository with `npm run build`, then render a source:

```sh
npm run artifact -- examples/welcome.showai.json artifacts/welcome.html
```

The packaged plugin can run without this repository or its dependencies:

```sh
node /absolute/path/to/showai/scripts/render-artifact.mjs input.showai.json output.html
```

The command accepts an optional third argument for a custom built viewer template. It requires Node.js 20 or later. It validates the source before writing output and rejects externally linked images, so a successful built-in document render is self-contained.

From the ShowAI browser application, HTML export downloads external images and embeds them. A remote server must permit this browser request. If an image cannot be read, is unsupported, or would exceed the document limit, export stops with an error; upload the local raster image and retry. Supported embedded formats are PNG, JPEG, GIF, WebP, and AVIF. SVG, executable URLs, and relative/file image paths are rejected. Image nodes, gallery images, and bookmark thumbnails are covered. Followed source links still require network access.

## Validation and limits

Source JSON is limited to 10 MB, 12,000 document nodes, and 48 levels of JSON nesting. Built-in widgets also have the limits described above. Invalid trees, unsupported node types, malformed marks, unsafe URLs, nonfinite numbers, and prototype-pollution keys are rejected before creating the editor. Unknown widget kinds preserve plain JSON data.

The generated file escapes embedded JSON and the HTML title. No document text is executed as code. The reader has no telemetry, background API, or account connection. Image embedding makes network requests only during browser export; ordinary source links navigate when activated.

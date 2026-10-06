# ShowAI artifact format, version 3

Version 3 stores recursively nested Page and Board surfaces. A Page is ordered content; a Board is a local spatial workspace. Both may be the root or an embedded module. New resources default to Page. Versions 1 (doc) and 2 (legacy whiteboard) remain readable.

## Envelope and containers

```json
{
  "format": "showai",
  "version": 3,
  "document": {
    "id": "research",
    "title": "Research",
    "content": {
      "type": "surface",
      "attrs": { "id": "page-root", "kind": "page", "name": "Page" },
      "content": [
        {
          "type": "surface",
          "attrs": { "id": "board", "kind": "board", "name": "Analysis" },
          "content": []
        }
      ]
    },
    "layout": {
      "board": {
        "x": 0,
        "y": 0,
        "width": 800,
        "height": 460,
        "heightMode": "fixed"
      }
    },
    "surfaceViews": {
      "page-root": { "initial": null, "saved": [], "readingOrder": ["board"] },
      "board": { "initial": null, "saved": [], "readingOrder": [] }
    }
  }
}
```

All non-text nodes, including surfaces, have unique stable `attrs.id`. Surface kind is `page` or `board`; nested surfaces require a surface or region parent. `region` remains a flow/grid/free layout group and `richText` holds ordinary editor blocks. The resource ID identifies the file; the root container ID identifies its content node.

`layout[nodeId]` describes the parent-owned frame: x, y, width, optional height and heightMode (`fixed` or `auto`). Auto height is supported for Page modules; Board modules keep a bounded viewport. Board and free-group children use local coordinates. Page and flow/grid children follow tree order. Region-only fields are mode, columns and gap. See [Page and Board](page-surface.md) for limits and interactions.

`surfaceViews[surfaceId]` contains `initial: viewId | null`, `saved: {id,name,targets: nodeId[]}[]`, and `readingOrder: childNodeId[]`. Targets belong to their owner; current scroll/camera/selection are local user state. Missing defaults are supplied at normalization. Invalid ids, geometry, kinds and references are rejected.

Optional envelope `presentation` is `spatial` (default) or `reading`. Page retains its ordinary flow under either; reading projects the selected root Board into reading order. Optional `selection: {blockIds}` identifies a partial artifact, preserving necessary container ancestors. Optional `components` bundles exact runtimes; `remoteComponents` contains verified publication locators. Sources retain complete editable geometry for their selected content.

Metadata includes ISO createdAt/updatedAt, icon, cover, parentId (project folder), favorite, archived and comments. Root title is metadata. The store returns a separate semantic hash; updates require that hash as base-hash.

Legacy v1 ordinary documents adapt to Page; v2 and legacy floating content retain Board arrangement. Managed upgrades preserve exact original bytes under migrations/resource-id/original-v1.json or original-v2.json and retain snapshots. Downgrading a stored resource is rejected.

## Board drawings

A drawing is `{type:'drawing',attrs:{id,name,tool,color,strokeWidth,extent,points}}`. Tool is pen, rectangle, ellipse or arrow; color is six-digit hex; strokeWidth is 0.5–40; extent is [width,height]; points is 2–20000 local {x,y} values. Drawings belong to Boards and have no children. Layout stores their position and displayed dimensions. Moving a drawing preserves its local points; resizing changes its frame. Keep drawings inside a Board module when placing them into a Page.

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

## Components

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

### Basic content

Basic components use the same widget envelope, with these kinds and data fields:

| Kind      | Data                                                                     |
| --------- | ------------------------------------------------------------------------ |
| `text`    | `content: string`, `format?: "markdown"                                  | "plain"` |
| `image`   | `src: string`, `alt?`, `caption?`, `width?`, `height?`, `fit?: "contain" | "cover"` |
| `table`   | `title?`, `columns: string[]`, `rows: (string                            | number   | boolean)[][]` |
| `callout` | `title?`, `content: string` (Markdown)                                   |
| `toggle`  | `summary: string`, `content: string` (Markdown), `open?: boolean`        |
| `divider` | `color?: string`                                                         |
| `code`    | `content: string`, `language?: string`                                   |

Appearance fields include `color`, `backgroundColor`, `fontSize`, `align`, `padding`, and `radius`. Tables have 1–100 columns and up to 1,000 rectangular rows. Image URLs and Markdown images must be embedded for offline delivery. Browser export embeds image component URLs and inline/reference Markdown images. Builtins are discoverable by Agent and expose a source wrapper for creating a project variant. Existing editor-native nodes remain readable in the same artifact format.

Custom components can import named builtins from `showai:components`, and exact custom children from `showai:component/ID` after declaring `manifest.dependencies`. The parent runtime bundles child implementations for offline and inline delivery. Catalog registration/publication additionally preserves the dependency source closure; see [component lifecycle](catalog-lifecycle.md).

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

### Installed custom React components

A custom component is imported from a local package containing `manifest.json`, `props.schema.json`, its React entry and any local resources. The manifest describes `id`, `name`, `version`, `description`, `scenarios`, `entry`, `defaultData`, and named `examples`. See [the value slider](../resources/catalog/value-slider).

The page node stores a reference and props:

```json
{
  "type": "widget",
  "attrs": {
    "kind": "custom",
    "data": {
      "componentId": "value-slider",
      "version": "1.0.0",
      "props": { "label": "Value", "value": 30, "min": 0, "max": 100 }
    }
  }
}
```

`componentId` uses lowercase letters, numbers and hyphens. `version` is an exact semantic version. An optional `integrity` records the expected compiled package hash. `props` must satisfy that version's JSON Schema. Component ids and props are data; putting arbitrary JavaScript in a node does not define a renderer.

The React entry exports a default component receiving `{ data, onChange?, readOnly }`. Use `onChange(nextData)` for authoring updates. In reading mode, persistent updates are disabled; local React state can still support temporary exploration. Installed package versions are immutable, so a source edit requires a new version.

The compiler supports React and package-local imports. Desktop and ordinary HTML render each component in an iframe with `sandbox="allow-scripts"`; the component cannot use the desktop bridge, filesystem or external network. The catalog keeps original package files for editing, while each exported artifact includes a deduplicated `components` array:

```text
components: [{
  id, name, version, description, scenarios, entry, defaultData, examples,
  scope, updatedAt, schema, html, integrity,
  inline?: { script, styles }
}]
```

`html` is the self-contained sandbox runtime generated by the component compiler. `inline` is a separately compiled mount bundle that reuses the reader's React runtime; both are covered by `integrity`. These fields are generated outputs, not values an Agent should hand-author. Importing the exported JSON validates and installs compiled packages into the selected project without executing them. A compiled-only import can render and export; editing its TSX source requires the original component package.

### Conversation inline mode

Some conversation surfaces disallow nested iframes. For those surfaces, `--format inline` explicitly marks the root as `data-showai-inline-root`. The reader uses each component's generated `inline.script` and `inline.styles`, mounted in Shadow DOM inside the host's existing whole-page sandbox. Styles are isolated per component; component JavaScript shares that host page's execution context. This mode is disabled when the desktop bridge (`window.showai`) is present.

The reader does not extract or evaluate scripts from arbitrary component HTML. Packages created before the inline mount bundle was available still work in the ordinary HTML reader; conversation mode reports that their original source must be imported under a new version. The complete UTF-8 fragment must remain under 1 MB. Larger pages should use standalone HTML.

### Application-level block registration

Developers changing ShowAI itself can still use `registerBlock` in `src/components/blocks/registry.ts`, load that registration in both app and reader builds, and rebuild. This is distinct from installing a component package through the catalog. Unknown widget kinds preserve their JSON and show a fallback instead of discarding content.

## Export and offline behavior

Build the repository with `npm run build`, then render a source:

```sh
npm run artifact -- examples/welcome.showai.json artifacts/welcome.html
```

The packaged plugin can run without this repository or its dependencies:

```sh
node /absolute/path/to/showai/scripts/render-artifact.mjs input.showai.json output.html
```

The command accepts an optional third argument for a custom built viewer template. It requires Node.js 22.12 or later. It validates the source before writing output and rejects externally linked images, so a successful render is self-contained. A custom page must include its compiled `components` payload; the project-aware CLI resolves that payload from the component catalog automatically.

From the ShowAI browser application, HTML export downloads external images and embeds them. A remote server must permit this browser request. If an image cannot be read, is unsupported, or would exceed the document limit, export stops with an error; upload the local raster image and retry. Supported embedded formats are PNG, JPEG, GIF, WebP, and AVIF. SVG, executable URLs, and relative/file image paths are rejected. Image nodes, gallery images, and bookmark thumbnails are covered. Followed source links still require network access.

For project pages, use the shared CLI rather than reading authoring files by hand:

```sh
node dist-agent/cli.mjs export --project PROJECT_ID --page PAGE_ID --format html --out ./report.html
node dist-agent/cli.mjs export --project PROJECT_ID --page PAGE_ID --format inline --out ./report-inline.html
node dist-agent/cli.mjs export --project PROJECT_ID --format site --out ./site
```

The standalone renderer also accepts `--inline`. Its output is an HTML fragment for a host-supported display surface; direct browser test wrappers must declare UTF-8. A static site uses external shared reader assets and should be served over HTTP or deployed to a static host. Only the single-file HTML is intended for direct offline opening.

## Validation and limits

Source JSON is limited to 10 MB, 12,000 document nodes, and 48 levels of JSON nesting. Built-in widgets also have the limits described above. Invalid trees, unsupported node types, malformed marks, unsafe URLs, nonfinite numbers, and prototype-pollution keys are rejected before creating the editor. Unknown widget kinds preserve plain JSON data.

The generated file escapes embedded JSON and the HTML title. Paragraph text and data remain escaped. Custom components are executable code supplied through the explicit component-package mechanism and run in the rendering boundary described above. The reader has no telemetry, background API, or account connection. Image embedding makes network requests only during browser export; ordinary source links navigate when activated.

## Catalog revision identity and remote delivery

Custom widget references use `componentId`, exact `version`, `integrity` and `props`, with an optional scope hint. Writes through the Agent and desktop services lock these references. Components with the same id/version but different fingerprints are distinct; a pinned reference must resolve its own fingerprint. Old sources without a fingerprint are normalized on their next authoring write. Existing immutable package content is never replaced by this normalization.

A remote artifact adds `remoteComponents` at the envelope level. Each locator has:

```text
{ ref: { kind: "component", id, version, integrity, scope? },
  bundleRef: { kind: "component" | "template", id, version, integrity, scope? },
  url, sha256, bytes, manifestUrl, manifestIntegrity, verifiedAt }
```

Use locators returned by publication verification, rather than inventing them. `sha256` protects the exact downloaded bundle bytes; `ref.integrity` selects and validates the component revision inside it. The reader checks both before mounting any custom code. HTTPS is required except for localhost/loopback HTTP used for self-hosting and tests. Cross-origin static hosting must permit CORS. Remote files require network access; inline exports require bundled components because the host blocks these network requests.

Importing a remote source verifies its locators and materializes the components into the selected project, preserving the version identity. A failed download or integrity check must leave the existing page untouched. Source templates are expanded before a page is saved; they are not required in the delivered page. See [catalog lifecycle](catalog-lifecycle.md) for versioned template definitions and immutable library registration.

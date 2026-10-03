---
name: show-document
description: Create or update portable ShowAI interactive documents when the user asks to present research, explain findings with interactive blocks, or deliver a ShowAI HTML artifact.
---

Build an editable `.showai.json` source and a standalone `.html` viewer. Use the user's requested language and level of detail. Prefer a coherent document with a few useful interactions over a dashboard of unrelated cards.

Read [the artifact format](references/artifact-format.md) for the JSON envelope, supported blocks, and widget schemas. [The welcome document](examples/welcome.showai.json) is a complete valid source to adapt.

Keep research claims tied to verified evidence and link the supporting sources in the document. Use charts only for actual supplied or researched numbers. Label an assumption or user-controlled scenario at its point of use. Preserve uncertainty and missing data; do not invent measurements to fill a visual.

Author a `format: "showai", version: 1` artifact. Text and widgets share one ordered document. Use links or bookmark blocks for sources; use chart, database, gallery, metrics, and playground blocks where they help the user inspect the result. The `widget` node takes `{kind, data}` in `attrs`. Arbitrary HTML and JavaScript are not supported. New block types are registered in the ShowAI application and need a rebuilt viewer before they render.

Render using the bundled command, resolving the plugin root two levels above this skill directory:

```sh
node /absolute/path/to/showai/scripts/render-artifact.mjs /absolute/path/to/research.showai.json /absolute/path/to/research.html
```

The packaged command needs Node.js 20 or later and has no install step or API key. Use embedded raster image data URIs for every document image, gallery image, and bookmark thumbnail. The command rejects external image URLs so the generated file remains self-contained. Resolve local images into embedded data before authoring the artifact. Source hyperlinks can remain web URLs; they require network access only when opened.

Open the resulting HTML in the available browser or file preview and inspect the rendered page. Check that the main question is answered, source links are present, and at least one relevant interaction works. If the environment cannot preview HTML, report that limit instead of claiming visual verification. Return links to the HTML and JSON source. Opening an artifact or building the plugin does not install or publish the plugin.

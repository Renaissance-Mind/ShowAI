---
name: show-document
description: Present research, explanations, or comparisons as one standalone interactive ShowAI HTML page when the user asks for a ShowAI page or an interactive visual result.
---

Deliver one content-focused `.html` page. Keep it as a simple canvas: a title, useful content, and interactions that help explain it. Use the user's language. Include only sections and controls needed by the subject. The bundled reader provides one small options menu.

Read [the artifact format](references/artifact-format.md) and adapt [the complete example](examples/welcome.showai.json). Author a `format: "showai", version: 1` JSON source containing one `document`. Put text, images, chart, database, gallery, metrics, and playground blocks in its ordered content. Registering new React blocks requires rebuilding the viewer; JSON contains data only.

Ground claims and charts in the user's data or verified sources. Link evidence next to the relevant claim. Label mathematical values, assumptions, and user-controlled scenarios where used. Omit unknown measurements. Keep sources concise and specific.

Render with the bundled command. The plugin root is two levels above this skill directory:

```sh
node /absolute/path/to/showai/scripts/render-artifact.mjs /absolute/path/to/result.showai.json /absolute/path/to/result.html
```

The command needs Node.js 20 or later; no install step, API key, server, or workspace is required. Embed raster image data URIs before rendering; the command rejects external image URLs to keep the page self-contained. Supporting source links may use web URLs.

Open the rendered HTML in the available browser or file preview. Inspect the layout and exercise a relevant interaction. Report any preview limitation honestly. Return the HTML as the primary deliverable and open it in Codex's file or browser panel when available. Keep the JSON alongside it for revision; offer a separate source link only if requested, since the page's options menu already downloads its source. The delivered HTML is exactly one page, including its interactive components and data.

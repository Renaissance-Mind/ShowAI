---
name: show-document
description: Present research, explanations, or comparisons as one standalone interactive ShowAI HTML page when the user asks for a ShowAI page or an interactive visual result.
---

Deliver one content-focused interactive page directly in the conversation when the host supports inline visualization. Keep it as a simple canvas: a title, useful content, and interactions that help explain it. Use the user's language. Include only sections and controls needed by the subject. The bundled reader provides one small options menu.

Read [the artifact format](references/artifact-format.md) and adapt [the complete example](examples/welcome.showai.json). Author a `format: "showai", version: 1` JSON source containing one `document`. Put text, images, chart, database, gallery, metrics, and playground blocks in its ordered content. Registering new React blocks requires rebuilding the viewer; JSON contains data only.

Ground claims and charts in the user's data or verified sources. Link evidence next to the relevant claim. Label mathematical values, assumptions, and user-controlled scenarios where used. Omit unknown measurements. Keep sources concise and specific.

Render with the bundled command. The plugin root is two levels above this skill directory:

```sh
node /absolute/path/to/showai/scripts/render-artifact.mjs /absolute/path/to/result.showai.json /absolute/path/to/showai-page.html --inline
```

The command needs Node.js 20 or later; no install step, API key, server, or workspace is required. Embed raster image data URIs before rendering; the command rejects external image URLs to keep the page self-contained. Supporting source links may use web URLs.

The `--inline` output is a fragment under 1 MB with bundled React and scoped product styles. Put it in the current thread's explicitly writable visualization directory when provided; otherwise use a durable task-owned output directory. Read the host's visualize skill if available, then emit the host-supported inline content reference in the final reply:

```text
visualize{"path":"/absolute/path/to/showai-page.html"}
```

This uses the host's conversational display capability, not an installed MCP tool call. Return the live page itself. Keep explanatory prose brief. Preview the actual fragment in the host sandbox and exercise a relevant interaction before delivery when tools permit.

For hosts without that capability, or when the user requests a downloadable file, omit `--inline` to produce standalone HTML and open it through the available file/browser panel. Keep the JSON alongside the output for revisions. Never claim native MCP UI integration or installation merely because the skill generated a page.

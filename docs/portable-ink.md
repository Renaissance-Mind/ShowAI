# Portable ink

The editable source is a `drawing` node with `attrs.ink.format = showai-ink-v1`. Each node represents one stroke. Browser, Electron (including Windows), and the iOS workbench use the same page model, validation, selection, style controls and board commands. The native adapter runs the committed `portable-ink.mjs` kernel in JavaScriptCore; browser adapters import that exact module.

## Coordinates and brush data

`brushVersion: 1` identifies the brush interpretation. `samples` retain `[x, y, time, nibWidth, nibHeight, opacity, force, azimuth, altitude]`. Time is in seconds and coordinates are local document units. `transform` is an affine `[a,b,c,d,tx,ty]` matrix. `extent` is the local object frame; the page layout applies its position, scale and rotation outside the stroke transform. An optional vector `mask` retains partial erasure. Native `seed` and `createdAt` stabilize round trips. No sample is silently downsampled: unsupported capacity fails without replacing the original drawing.

`attrs.color`, `attrs.strokeWidth` and `attrs.pressure` are editable style overrides. Width and pressure resolve through `portableNodeSamples`; toggling pressure keeps original sample measurements. Geometry, painted hit tests, bounds and navigation previews share the pure kernel. Root poses derive from document layout rather than rounded CSS boxes; nested poses use the committed container layout.

The browser paints vector contours. PencilKit remains the iOS input and live rendering adapter. Its proprietary smoothing and brush textures can differ from the portable contour renderer; matching editable data and operations does not imply identical platform rasterization. Per-point opacity is retained for native round trips; portable contours currently use stroke opacity. Brush changes require a new version when their interpretation changes.

## Saving and simultaneous edits

Native captures encode on worker tasks. A save sends changed nodes, removed IDs and only those nodes' original `baseNodes` / `baseLayout`. Applying it merges against the current editor model. Independent additions and disjoint property edits merge; delayed edits cannot resurrect a remotely deleted stroke. A stale eraser cannot silently remove a stroke whose properties or layout changed remotely; that deletion is a conflict. Competing edits to the same property raise `INK_EDIT_CONFLICT`, and the attempted local result is written to a recoverable page draft. Page synchronization continues to use revision-conditioned publishing and the existing three-way page merge. History is rebased when an external document arrives.

The native bridge has a separate acknowledged scene protocol. A scene patch carries a small hierarchy of `ink-ref` IDs, current ink layouts, and only changed stroke payloads. `baseVersion` names the last accepted scene and `version` identifies its successor. The adapter reconstructs the scene off the main actor. A frame rejected while native input is unpublished must not advance either side's accepted cache. A fresh current-model frame is requested after saving, while the visible PencilKit drawing remains authoritative for active input. Camera updates carry no document payload.

This provides merge-safe asynchronous multi-device editing through the existing sync transport. It does not introduce a live presence service or character/point-level CRDT. Simultaneous edits to one stroke's sample array are treated as a conflict rather than arbitrarily interleaved.

## Migration and compatibility

Existing `showai-pencilkit-v1` nodes continue to decode. On the next native edit/save they become independent portable strokes. The exact original archive is kept as `sourceDrawing`, including when one legacy aggregate becomes several editable nodes. Portable strokes decode from their samples even when no archive or PNG exists. Old browser pen/highlighter drawings are adapted to the same sample representation.

New clients should be upgraded together before sharing portable ink. Older builds without the new format validator cannot author this format safely. Source snapshots in the iOS repository record the exact shared commit and bundle hashes; website deployments and installed Windows/macOS builds still need their normal release process.

# Portable ink

The editable source is a `drawing` node with `attrs.ink.format = showai-ink-v1`. Browser, Electron (including the Windows build), and iOS use the same page model and causal ink operations. Input processing and geometry share C++ sources compiled as an iOS library and WebAssembly. Build provenance records the source digest and compiler configuration. Platform renderers consume this geometry; textures and screenshots are disposable caches.

## Input and geometry

`brushVersion: 1` identifies the portable brush interpretation. `samples` retain `[x, y, time, nibWidth, nibHeight, opacity, force, azimuth, altitude]`. Time is in seconds and coordinates are local document units. `transform` is an affine `[a,b,c,d,tx,ty]` matrix. `extent` is the local object frame; page layout supplies position, scale and rotation outside that transform. A vector `mask` retains partial erasure. Native `seed` and `createdAt` stabilize round trips.

New native input also preserves `showai-input-v1` source data: a source identity, frozen creation configuration, ten-field actual samples, and fitted curves with raw-sample ranges. Raw samples contain position, time, force, azimuth, altitude, point identity, expected-property flags, estimation index and timeout state. Coalesced actual contacts enter the source; predicted contacts only affect the provisional display tail. Later estimated-property corrections update the observed geometry while preserving concurrent style and layout changes. Creation parameters retain the original interpretation even after editable width or pressure changes.

A long stroke has one logical node and optional `attrs.inkFragments`. Fragments share creation style, transform, extent, selection and undo identity. Coverage is combined before applying the logical stroke's opacity, including marker overlap. Capacity limits fail explicitly instead of silently dropping samples. `attrs.color`, `attrs.strokeWidth` and `attrs.pressure` remain editable overrides; changing pressure preserves original measurements.

The C++ input kernel owns temporal smoothing, force interpretation, curve fitting, finalized prefixes and provisional tails. The geometry kernel owns portable contours, bounds, masks and painted hit tests. Browser vector painting and native Metal painting use these shared interpretations. Native/WebAssembly parity checks validate the compiled kernels; they do not establish pixel-identical antialiasing on every GPU or physical Pencil latency.

## Native scene ownership

On iPad, one native camera and retained Metal scene display ink, shapes and versioned Page/component textures. Drawing, erasing, selection, dragging, zooming and inertia use this scene. Camera changes reuse retained geometry. Ordered geometry updates remain queued while replaceable camera requests can coalesce. Rich content continues to use the shared workbench for editing and layout; duplicate native-owned web ink and shapes are hidden.

The scene protocol carries acknowledged versions, object identities, changed payloads and current poses. A rejected frame cannot advance the accepted cache. Camera updates carry no document payload. PencilKit is used to read legacy archives through public APIs; it is no longer the live input/rendering owner of the new native Board.

## Causal edits and durability

`showai-ink-operation-v1` records actual actor/operation identities, sequence numbers and observed causal context. Registers cover geometry, fragments, node metadata, color, width, pressure, layout, placement and liveness. Independent field edits merge. Concurrent values remain candidates; explicit conflict resolution authors a real operation against observed heads. Deletion conflicts and unseen remote edits cannot be erased by an old snapshot. Selective undo compensates eligible local operations while preserving foreign or competing current heads.

The native JavaScriptCore worker executes the same committed operation and wire modules as the shared application. Native and desktop SQLite journals use WAL and FULL synchronization. Actual operations commit atomically before durability is acknowledged; recovery replays the real journal. Sparse projection updates touched objects without rebuilding a complete checkpoint after each stroke. Predicted samples never become durable operations. A failed save retains pending work, and an older acknowledgment cannot replace newer input.

`showai-ink-state-v1` carries causal state and retained variants in page snapshots. Existing revision-conditioned publication and three-way page merge transport this state between devices. This supports merge-safe simultaneous editing through the current asynchronous synchronization service. Live presence and streaming individual contacts require their own transport; the current protocol does not claim to provide that service.

## Source publication and the web editor

Native-to-web `showai-native-source-v1` envelopes identify immutable complete publications, scoped by project, page, Board and session token. A publication includes the original writer baseline and history actions. Transport differences use exact JSON edits, including middle-array splices; they are distinct from causal operations. Only a real successful save advances the transport baseline. Cache misses expand the original captured publication, and retries keep that publication separate from later pending edits.

Private transport graphs remain separate from mutable UI documents. Complete normalization and body comparisons preserve unknown fields and detect actual editor changes. Surviving UI nodes can be reused only after their entire contents compare equal. Source versions alone cannot prove equality. Save receipts are temporary session metadata and do not enter page attributes. A body-equivalent receipt can still introduce a fresh actual history operation, so receipt/history deduplication uses scoped operation identities.

This correctness boundary still has a measured cost: the current iPad Release validation has passed native input/rendering thresholds but failed web-frame and complete-save thresholds. Incremental publication does not make the remaining whole-document UI and persistence work disappear. See the iOS repository's validation record for device measurements; Notability-equivalent writing is not an established result.

## Migration and compatibility

Legacy `showai-pencilkit-v1` archives are converted through public PencilKit APIs to editable canonical strokes. Their exact original archive remains available for recovery. Aggregate-node transforms and grouping survive conversion, and partial erasure remains editable. Portable strokes work without an archive or PNG. Old browser pen/highlighter drawings adapt to the portable representation.

New clients should be upgraded together before sharing new ink formats. Older validators cannot safely author formats they do not understand. The iOS repository pins a committed shared source revision and bundle digests. Website deployments and installed Windows/macOS applications require their normal release process; source parity alone is not runtime acceptance on those platforms.

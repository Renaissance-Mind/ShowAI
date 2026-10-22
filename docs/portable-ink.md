# Portable ink

New shared pen/marker input is a `drawing` node with `attrs.ink.format = showai-ink-v2`; existing `showai-ink-v1` nodes retain their original interpretation. Browser, Electron (including the Windows build), and iOS use the same page model and causal ink operations. Input processing and geometry share C++ sources compiled as an iOS library and WebAssembly. Build provenance records the source digest and compiler configuration. Platform renderers consume this geometry; textures and screenshots are disposable caches.

## Input and geometry

`showai-ink-v2` stores piecewise center curves (point, line, quadratic or cubic) and an explicit linear radius on each segment. These are the sole geometry source. `geometryVersion: 1` and the persisted `outlineTolerance` select the shared circular-sweep derivation. Adaptive outline commands, coverage patches, SVG strings, GPU buffers and textures are disposable derived values. Round pen/marker and monoline interpretations are supported; unsupported brushes fail explicitly. Existing v1 samples, masks, fragments and archives are not silently reinterpreted.

`transform` is an affine `[a,b,c,d,tx,ty]` matrix. `extent` is the local object frame; page layout supplies position, scale and rotation outside that transform. New browser strokes freeze a pen-down local basis and apply a final translation through this affine, so sealing does not refit or rewrite the centers or raw capture. Color, width, pressure and layout remain independent editable overrides.

The optional `showai-input-capture-v1` source contains the frozen creation configuration and every accepted actual sample: `[x,y,time,force,azimuth,altitude,id,expectedProperties,estimationIndex,updatesTimedOut]`. Time is seconds from the first actual contact. Coalesced points retain their original order and identities; predictions only replace the provisional tail and are removed before sealing. Browser pen pressure preserves the standardized sensor value, while mouse/finger input uses force 1. Browser normalized pressure is not a claim of UITouch force calibration. Pointer Events provide no equivalent of the native post-seal Pencil estimation channel; browser same-contact sensor corrections preserve the original position/id.

The actual browser/Electron writer runs `CompiledInkInput` and `CompiledInkStroke` on a dedicated Worker. It preserves original input-kernel batch boundaries, all pressure knots and the changed source suffix. There is no 0.7px actual-point filter, 20,000-point truncation, saved v1 stand-in or raster substitute. Accepted contacts reserve distinct history edges immediately; the existing save/close barriers await the actual canonical result. Later UI changes remain independent, including a new object created before an earlier stroke finishes. A failed Worker keeps raw input available for explicit retry and cannot report a successful save.

Derived preparation uses fixed 128-source-segment chunks with whole-stroke budgets of 1,000,000 commands/100,000 leaves and a 100,000-command per-chunk consumer limit. All chunks are unioned in one opacity composite. The Worker and UI retain bounded derived caches. Only actual Worker requests/results bind a recursively immutable source, complete style and derivation parameters; a nonce or shallow freeze cannot claim a geometry proof. SSR and independent readers use the same synchronous C++/WebAssembly interpretation. Browser edited-node preparation is asynchronous; standalone HTML readers need no Worker assets. Painted hit queries continue to use the shared geometry kernel.

v1 retains its nine-field samples, vector masks, seeds and optional `attrs.inkFragments`, which share one logical selection/undo/opacity identity. v2 forbids these alternate source fields. Capacity and geometry budgets fail explicitly rather than dropping samples or changing format. Kernel parity establishes shared source interpretation, not pixel-identical antialiasing on every GPU or physical Pencil latency.

## Native scene ownership

On iPad, one native camera and retained Metal scene display ink, shapes and versioned Page/component textures. Drawing, erasing, selection, dragging, zooming and inertia use this scene. Camera changes reuse retained geometry. Ordered geometry updates remain queued while replaceable camera requests can coalesce. Rich content continues to use the shared workbench for editing and layout; duplicate native-owned web ink and shapes are hidden.

The scene protocol carries acknowledged versions, object identities, changed payloads and current poses. A rejected frame cannot advance the accepted cache. Camera updates carry no document payload. PencilKit is used to read legacy archives through public APIs; it is no longer the live input/rendering owner of the new native Board.

## Causal edits and durability

`showai-ink-operation-v1` records actual actor/operation identities, sequence numbers and observed causal context. Registers cover geometry, fragments, node metadata, color, width, pressure, layout, placement and liveness. Independent field edits merge. Concurrent values remain candidates; explicit conflict resolution authors a real operation against observed heads. Deletion conflicts and unseen remote edits cannot be erased by an old snapshot. Selective undo compensates eligible local operations while preserving foreign or competing current heads.

The native JavaScriptCore worker executes the same committed operation and wire modules as the shared application. Native and desktop SQLite journals use WAL and FULL synchronization. Actual operations commit atomically before durability is acknowledged; recovery replays the real journal. Sparse projection updates touched objects without rebuilding a complete checkpoint after each stroke. Predicted samples never become durable operations. A failed save retains pending work, and an older acknowledgment cannot replace newer input.

`showai-ink-state-v1` carries causal state and retained variants in page snapshots. Existing revision-conditioned publication and three-way page merge transport this state between devices. This supports merge-safe simultaneous editing through the current asynchronous synchronization service. Live presence and streaming individual contacts require their own transport; the current protocol does not claim to provide that service.

## Source publication and the web editor

Native-to-web `showai-native-source-v1` envelopes identify immutable complete publications, scoped by project, page, Board and session token. A publication includes the original writer baseline and history actions. Transport differences use exact JSON edits, including middle-array splices; they are distinct from causal operations. Only a real successful save advances the transport baseline. Cache misses expand the original captured publication, and retries keep that publication separate from later pending edits.

Private transport graphs remain separate from immutable UI snapshots and explicit mutable drafts. The actual SourceRuntime owns registered bodies; worker normalization and exact COW changes preserve unknown fields and detect actual editor changes. Surviving UI nodes reuse independently owned unchanged branches. Source versions alone cannot prove equality. Save receipts are temporary session metadata and do not enter page attributes. A body-equivalent receipt can still introduce a fresh actual history operation, so receipt/history deduplication uses scoped operation identities.

iPad performance gates remain under device validation. Moving preparation off the UI thread does not establish GPU or complete-save latency. See the iOS repository's validation record for current measurements; Notability-equivalent writing is not an established result.

## Migration and compatibility

Legacy `showai-pencilkit-v1` archives are converted through public PencilKit APIs to editable canonical strokes. Their exact original archive remains available for recovery. Aggregate-node transforms and grouping survive conversion, and partial erasure remains editable. Portable strokes work without an archive or PNG. Old browser pen/highlighter drawings adapt to the portable representation.

New clients should be upgraded together before sharing new ink formats. Older validators cannot safely author formats they do not understand. The iOS repository pins a committed shared source revision and bundle digests. Website deployments and installed Windows/macOS applications require their normal release process; source parity alone is not runtime acceptance on those platforms.

## Shared writer verification

`node scripts/test-portable-cubic-ui.mjs` builds the real frontend/Worker/reader and checks the actual loopback Workbench with FileStore persistence: pointer writing, source-preserving style/erase/Undo/Redo, cold reopening, pending leave/clear/dispose/page switch, and a debugger-held real Worker with a later UI object. It also checks standalone Canvas local recovery and self-contained vector HTML. `node scripts/portable-cubic-desktop-smoke.mjs` checks the sandboxed Electron file renderer after the desktop build. These macOS/Edge/Electron tests do not establish installed Windows, website deployment or iPad acceptance.

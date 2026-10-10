# Content library

ShowAI stores current project content in transactional SQLite, alongside a readable workspace, local editing drafts and rebuildable search indexes. Projects resolve from the host directory; explicit project selection takes precedence.

## Storage contract

The SQLite database at `history/content.sqlite` is authoritative. The directory name remains compatible with existing libraries. A save atomically updates compressed content objects, current file references, resource concurrency tokens and the current operation receipt. It then materializes readable workspace files through a durable recovery journal. Content objects superseded by new saves are reclaimed when current content and retained legacy archives no longer reference them.

Pages store metadata and stable content nodes separately. Data URL bytes are addressed by digest under `assets/`; their JSON envelope records exact locations and MIME types. Reading and export assemble the complete document. Components, templates, editable source files and compiled packages preserve the precise dependency identities referenced by current pages.

Resource tokens detect changes even when content changes from A to B and back to A. Saves check both the page hash and its resource token. An operation ID identifies one request; reuse with different edits is rejected. A retry after newer edits requires reading current content before issuing a new operation.

## Reading and search

Reading uses a consistent current database state while cooperating writers wait. Page preview, interactive reading and HTML export use the installed renderer and generate output on demand.

The search index represents a named current state. It includes page text, nested containers, component props, package descriptions and source files. Results carry project, resource and node identities, locations, snippets and the index token. Search cursors reject changes to the query or indexed state. Indexing does not execute component code.

## Drafts and conflicts

Editor drafts persist with window identity, sequence and atomic generations. An active draft retains one original page baseline for comparing its changes with current content. Agent reads retain a replaceable session/page baseline in a bounded cache. Independent fields merge automatically; ambiguous choices retain the original values for review.

Failed transactions preserve incoming edits. External file changes are captured before replacing workspace projections and block publication of the affected resource. External package recovery creates an editable draft and runs the real compiler and validator before publication. Editor undo and redo remain available during editing.

## Synchronization

Each device transfers current page data, component dependencies and assets. A device retains its last synchronized baseline and bounded recovery inputs for concurrent or interrupted work. The server checks the expected current token before publication. See [Project server and synchronization](project-sync.md).

## Existing libraries and maintenance

Existing Git libraries migrate under the writer lock, with original records, bytes and IDs verified before activation. Original Git archives and preexisting SQLite records remain retained as recovery material. Subsequent saves update current content. Import preserves source files and validates current pages, packages and dependencies before activation.

Storage statistics distinguish content objects, readable files, indexes, caches, drafts, conflicts and retained originals. Compaction serializes database maintenance under a writer lease. Reviewed cleanup verifies fingerprints and live references before deleting eligible generated caches. Backups include current content and protected recovery material.

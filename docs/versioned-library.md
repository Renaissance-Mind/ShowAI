# Versioned content library

The target library has one application-managed Git repository for committed content, a readable workspace, local editing drafts, and rebuildable SQLite indexes. The storage engine keeps independent commits even when content returns to an earlier state. Projects continue to resolve from the host directory; explicit project selection takes precedence.

## Storage contract

```text
library/
  library.json
  repository.git/
  workspace/
  local/
    transactions/
    drafts/
    receipts/
  index.sqlite
```

The committed `content` ref is authoritative. A transaction persists its incoming edits and journal, imports blobs and a candidate commit, compares and updates the committed ref, then materializes readable workspace files. A failure after the ref update is recoverable from the candidate and committed state; a failure before it retains the input as an interrupted draft. Working copies and indexes are projections, not additional authorities.

The repository stores page metadata separately from stable content nodes. Data URL bytes are content addressed under `assets/`; the stored JSON envelope records their exact locations and MIME types. Slot locations keep application metadata separate from arbitrary component props. Page assembly and portable export return full JSON; storage objects are an internal representation.

Components, template definitions, source files, and compiled portable packages belong to versioned content. Historical rendering must retain the exact dependency closure. Rebuildable execution caches, thumbnails, and personal view state do not require commits.

Each change records an independent Git revision, parent revisions, commit time, actual actor kind, Agent harness/session when available, entry channel, touched resources, operation/group IDs, and optional restore/merge origins. A retried operation with the same content returns its original commit; reusing an operation ID with different content is a conflict. Resource revisions are required to distinguish content changes such as A → B → A.

## Structural comparison and merge

Pages flatten into stable nodes with separate ownership and order. Different data fields merge recursively. Plain-text spans merge at character boundaries while preserving their marks; richer ambiguous text edits remain conflicts. Array-valued component props have conservative whole-array conflicts. Node moves, reading order, layout, detached nodes, duplicate ownership, and cycles require structural validation. A conflict preserves an intact local draft and all three values.

Components do not need their own merge functions. Optional schema hints may improve labels and array element identity later; correctness must not depend on such hints.

## Derived indexes

The SQLite index names the exact Git revision it represents. Updates reload changed resources and add committed history records; a missing or non-ancestral index rebuilds from committed content. Queries expose project, resource and node identities, location paths, result snippets and the indexed revision. Search cursors reject query or revision changes.

Search includes page text, nested container names, component props, descriptive package metadata and source files. CJK unigram/bigram tokens support short Chinese terms. The reference graph records page/package dependencies. Historical queries support resource, project, Agent session, date and change-message filters. Indexing does not execute component code or include temporary interaction state.

## Implementation status

- Implemented and independently tested: Git object storage, page/node and data URL encoding, commit metadata, resource revision checks, retries, materialization recovery, restore commits, lossless repacking, structural page merge, incremental/rebuildable search, reference edges and history filters.
- FileStore now routes projects and pages to Git when a versioned library has been explicitly initialized. It stages compound writes, exposes resource revisions, rejects stale A → B → A writes, and reads versioned diffs. Component source JSON round-trips exact bytes. The live user library remains on the original store; it has not been migrated or activated.
- Remaining integration: actor propagation and operation-response replay at application boundaries; catalog/publication routing; persistent editor drafts; external-file reconciliation; exact historical dependency recovery; CLI/MCP/workbench endpoints; history/search/merge interfaces; storage accounting and maintenance; one-time legacy import; packaged-runtime checks and realistic scale benchmarks.

Before activation, failed callback drafts and interrupted lock recovery must be covered. External workspace edits must be preserved and surfaced rather than overwritten during materialization or recovery. Historical source provenance must never be inferred from old snapshots. One-time import must retain the original library and explicitly mark unknown historical times/authors. Copying, restoring and archiving a library must verify resource and history completeness.

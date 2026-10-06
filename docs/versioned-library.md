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
- FileStore now routes projects and pages to Git when a versioned library has been explicitly initialized. It stages compound writes, exposes resource revisions, rejects stale A → B → A writes, and reads versioned diffs. Component source JSON round-trips exact bytes; encoded metadata preserves property order for compiled integrity checks.
- Catalog writes, source recovery, dependency-closure promotion, portable imports and verified publication receipts now share the same staged workspace and transaction. Tests compile real components, use pending versions in templates/pages, promote source closures, and verify real HTTP publication bytes before committing receipts and packages together.
- CLI, MCP and workbench entrypoints propagate actor/channel, operation/group IDs and conditional page revisions. API request fingerprints permit response replay before running a mutation again. Response descriptors reference committed page/component/source files to avoid duplicating full pages, image bytes and compiled runtimes in change metadata. Real CLI, MCP and browser bridge tests cover replay, source attribution and stale revision rejection.
- Editor auto-saves now send baseRevision and stable per-request IDs; continuous edits carry group IDs. Failed staged callbacks preserve their input and reason in local failed-operation drafts. The live user library remains on the original store; it has not been migrated or activated.
- Workspace writes and recovery now compare the observed projection against a committed baseline. External edits/deletions are retained in local conflict records, block only their resource, and have explicit discard/import/merge resolution APIs. Recovery leaves conflicting external bytes untouched while completing independent projections. Tests verify post-baseline edits and new external modifications during resolution.
- Local page/component/template drafts now have atomic generations and shared content-addressed assets, including assets nested inside editable component forms. Page drafts carry window identity, sequence and the original base revision, which survives recovery and another restart. Stale generations cannot delete newer drafts; completion requires a matching committed page. Own-window page drafts recover automatically; other-window drafts are offered for explicit selection. Reviewed merges archive the exact selected source generation. Component/template forms retain incomplete JSON, source, descriptions and layout; reopening offers separately retained drafts, and publishing clears matching generations. Draft manifests reject paths outside their resource/generation.
- Writer/index/draft leases now atomically publish prewritten owners using hard links. Real child-process tests verify SIGKILL recovery and that live leases are never removed.
- Shared LibraryOperations now exposes scoped history, body/source searches, exact revision comparisons, historical page reads, reviewed page merge commits, conditional restore commits and retained workspace conflict resolution. CLI and project-bound MCP expose these operations; workbench handlers are connected for the upcoming interface. Actual CLI/MCP tests cover search, compare/read, restore response replay and project scope.
- Historical page restoration collects and verifies the exact component dependency closure from its source revision. Needed compiled/source files are retained in a per-project integrity-addressed recovery area, which resolves locked references without replacing current same-name/version slots. Tests remove current package files and verify historical recovery, rendering dependencies and editable source reading.
- The workbench now has page/project history, timestamps and actor/session provenance, arbitrary comparison bases, file selection, structured page changes, raw source/package comparisons, full page previews and conditional restore. Search opens matching pages/blocks and scoped component/template versions. Merge previews retain conflict triples and require explicit review before saving unresolved choices. External page edits support import, reviewed merge or returning to the formal version while retaining the external snapshot. Saving a component no longer reopens its editor after the user has moved to another dialog; draft notices do not steal input focus.
- Remaining integration: external package-draft import; frozen historical reader/runtime capture; storage accounting and maintenance; one-time legacy import and default library activation; packaged-runtime checks and realistic scale benchmarks. The live library has not been migrated or activated.

Before activation, draft recovery, external conflict controls and process interruption must be exercised through the complete versioned workbench. External workspace edits must be preserved and surfaced rather than overwritten during materialization or recovery. Historical source provenance must never be inferred from old snapshots. One-time import must retain the original library and explicitly mark unknown historical times/authors. Copying, restoring and archiving a library must verify resource and history completeness.

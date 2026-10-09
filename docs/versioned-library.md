# Versioned content library

The versioned library has **one application-managed Git repository** for committed content, a readable workspace, local editing drafts, and rebuildable SQLite indexes. The storage engine keeps independent commits even when content returns to an earlier state. Projects continue to resolve from the host directory; explicit project selection takes precedence.

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

The **committed `content` ref is authoritative**. A transaction persists its incoming edits and journal, imports blobs and a candidate commit, compares and updates the committed ref, then materializes readable workspace files. A failure after the ref update is recoverable from the candidate and committed state; a failure before it retains the input as an interrupted draft. Working copies and indexes are projections, not additional authorities.

The repository stores page metadata separately from **stable content nodes**. Data URL bytes are content addressed under `assets/`; the stored JSON envelope records their exact locations and MIME types. Slot locations keep application metadata separate from arbitrary component props. Page assembly and portable export return full JSON; storage objects are an internal representation.

Components, template definitions, source files, and compiled portable packages belong to versioned content. Historical rendering must retain the **exact dependency closure**. Rebuildable execution caches, thumbnails, and personal view state do not require commits.

Each change records an **independent Git revision**, parent revisions, commit time, actual actor kind, Agent harness/session when available, entry channel, touched resources, operation/group IDs, and optional restore/merge origins. A retried operation with the same content returns its original commit; reusing an operation ID with different content is a conflict. Resource revisions are required to distinguish content changes such as A → B → A.

## Structural comparison and merge

Pages flatten into stable nodes with separate ownership and order. Different data fields merge recursively. Plain-text spans merge at character boundaries while preserving their marks; richer ambiguous text edits remain conflicts. Array-valued component props have conservative whole-array conflicts. Node moves, reading order, layout, detached nodes, duplicate ownership, and cycles require structural validation. A conflict preserves an intact local draft and **all three values**.

Components do not need their own merge functions. Optional schema hints may improve labels and array element identity later; correctness must not depend on such hints.

## Derived indexes

The SQLite index names the **exact Git revision** it represents. Updates reload changed resources and add committed history records; a missing or non-ancestral index rebuilds from committed content. Queries expose project, resource and node identities, location paths, result snippets and the indexed revision. Search cursors reject query or revision changes.

Search includes page text, nested container names, component props, descriptive package metadata and source files. CJK unigram/bigram tokens support short Chinese terms. The reference graph records page/package dependencies. Historical queries support resource, project, Agent session, date and change-message filters. Indexing does not execute component code or include temporary interaction state.

## Application behavior

ShowAI 0.8.0 initializes a versioned library for a new empty home. Existing libraries use one-time preparation, validation and activation. Formal pages, projects, folders, sidebar organization, component/template definitions, editable sources, compiled dependencies and publication receipts share the transaction engine. CLI, MCP, browser and Electron writes carry conditional resource revisions and source context. Default project selection resolves the canonical host directory, including its Git root; explicit project selection wins. Multiple sessions in the same directory reuse the same project. Storage-home selection chooses the content library independently of project selection.

The workbench exposes page/project history with full timestamps, actor and Agent session, arbitrary comparison bases, structured changes, raw package/source comparisons, frozen previews and restore as a new commit. Scoped search opens matching pages, blocks and package versions. Merge review retains the base, local and formal values. Independent fields merge automatically; ambiguous choices require review before publication.

### Drafts and external changes

Editor drafts persist separately with window identity, sequence, original base and atomic generations. Recovery keeps unfinished JSON, source files, layout and shared assets. Completing or copying a draft clears only its matching committed generation. Failed transactions retain their input. External file edits are captured before any projection replacement and block the affected resource. External package recovery covers normal versions, retained source caches and historical dependency depots. It creates a repairable form draft and retains the exact file snapshots before resetting the immutable projection; publication produces a new version through the real compiler and validator.

### Frozen readers and dependency versions

Historical pages resolve their exact compiled and editable dependency closure into an integrity-addressed project depot. **Every new page commit** binds a content-addressed self-contained reader containing its emitted code, dependencies and styles. Historical preview, restore and single-page HTML/inline export use that reader. Reader integrity is verified on read; missing or corrupted readers report their cause while retaining content.

## Import and provenance

Import prepares a complete library, checks pages, packages, source fingerprints, dependencies, indexes and Git integrity, then compares the source inventory again under a writer/draft barrier. The format marker is published last. Interrupted activation resumes the same preparation; a later source change requires a fresh preparation. **Original files stay in place**, and their exact compressed bytes also belong to the imported Git history.

Old checkpoints remain a separately labeled collection. Their edit time, actor and order are unknown; filesystem timestamps are observations. Invalid snapshots retain their original bytes and report why they cannot render. A restored old snapshot creates a new attributed commit with import/snapshot origin. Imported historical readers are captured at import time and labeled accordingly; their original runtime is unknown. Versions predating reader capture do not silently substitute a current runtime.

New records capture the time recorded by the host, entry channel and available source identity. Codex CLI calls inherit the actual `CODEX_THREAD_ID`; other harnesses can supply their own identity. Missing identity stays unknown. Actor/session metadata is attribution provided by the entrypoint, not an authenticated or tamper-proof audit identity.

## Space and recovery

Storage statistics distinguish logical bytes, filesystem allocation, Git objects/packs, readable content, indexes, caches, drafts, conflicts, transaction inputs, preparation archives and original-library files. Idle persistent hosts repack under configurable thresholds and a serialized writer lease. Compression keeps all commits and limits worker memory/threads. Interrupted maintenance reports its state; users can disable automatic packing.

### Reviewed cleanup

Cleanup first creates a durable review plan, then verifies fingerprints and current draft references again. Eligible data includes generated reading outputs, old compiler caches, receipt JSON, orphan draft assets and duplicate compressed import bytes already verified in Git. Formal history, original-library files, current/discarded drafts and conflict snapshots remain protected. Explicit user exports retain their ownership. Complete archives copy protected content and recovery data under cooperating leases, verify every file and Git history, and can reopen with rebuilt indexes. **Formal history is preserved**; there is no automatic destructive retention policy.

### Archive recovery

Archives provide recovery from missing or damaged committed objects. Integrity checks expose corruption and preserve readable projections; they do not fabricate missing content. Lossless compression and deduplication reduce repeated edits, but newly changed image/video bytes and separately compiled component versions still consume space.

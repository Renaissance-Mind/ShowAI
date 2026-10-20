# Components and templates

**Language:** English | [简体中文](i18n/catalog-lifecycle.zh-CN.md) · [Documentation](README.md)

ShowAI stores reusable resources as verified, immutable revisions. Create within a project, explicitly promote for local cross-project reuse, and verify actual hosted bytes before registering a publication. Pages pin component versions; templates expand into independent Pages.

## Scopes and identity

| Scope       | Source                                      | Write path                             |
| ----------- | ------------------------------------------- | -------------------------------------- |
| `project`   | Created, imported or forked in a project    | Save with an explicit project ID       |
| `global`    | Explicitly registered local shared revision | Promote with target `global`           |
| `published` | Verified hosted package                     | Publication verification/import        |
| `builtin`   | Runtime-provided components/templates       | Derive a project revision to customize |

An exact identity is `{kind,id,version,integrity}`. Scope/project ID are lookup hints. Equal names and versions can have different fingerprints across scopes. Lookup with a fingerprint continues until it finds that exact revision unless explicitly restricted to one scope. Page writes validate props and lock refs to version/integrity while removing storage hints.

Within a scope, an ID/version identifies one immutable package. Identical reimports reuse it; changed content needs a new version. Forks record `parents`. Compiled-only imports can render, but source editing requires verified editable source. Restoring source recompiles and compares fingerprints before caching it; the original compiled package remains unchanged.

## Discover and compose

Read current catalog metadata, where each component entry carries a one-line signature of its data fields and types, then a selected revision's usage guide, parameters, schema/examples and, when developing, source. The default component list includes built-ins and the selected project's revisions; request global/published/all scopes for other entries. Explicit pagination returns cursors that must be restarted when the catalog changes.

Markdown (`text`) combines headings, paragraphs, lists, quotations, code and dividers. Image/table components provide dedicated editing. `showai:components` exports these and the other built-in React implementations for custom parents.

Declare exact custom child refs in `manifest.dependencies` and import `showai:component/ID`. The compiler validates source digests, resolves package-local modules and bundles children. Each child validates its props; connect its `onChange` into parent data and pass `readOnly`. Limits are 16 nesting levels and 100 packages, with unique dependency IDs per parent. Compilation needs each child's verified source.

Catalog dialogs show documentation and live preview side by side or stacked on narrow screens. Selecting an example updates preview/data and controls what is inserted.

## Merge revisions

Supply exact `base`, `ours` and `theirs`. Preview merges independent JSON fields and nonoverlapping text edits; arrays are atomic. Conflicting edits, delete/edit conflicts or conservative large-text comparisons return paths and original values. Preview retains ours as an editable candidate and does not write the catalog.

Resolve into a complete package with a new version or ID. Save rechecks refs, recompiles components or relocks templates, and records both parents plus mergeBase. Missing historical revisions must be restored before a three-way merge.

## Templates

Use [template folders and stage guides](template-bundles.md) for new reusable methods. A folder can include a Page skeleton and versioned component library. Legacy definitions with `document`, `composition`, `contentGuide`, `scenarios`, `related` and `examples` remain supported.

In legacy composition, ordered parts are `{type:"content",content:DOC_NODE}` or `{type:"template",ref:EXACT_REF,title?:STRING}`. Subtemplates expand recursively; optional titles become level-two headings. Save locks explicit refs. Instantiation rejects missing dependencies/cycles, limits depth to 16 and expanded nodes to 12,000, locks components and assigns new Page/node/view identities. Later template updates do not modify existing Pages.

## Promote and publish

Promotion copies the complete exact dependency closure, including available sources/assets. All destination slots are checked before writing. A conflicting global revision fails before publication; children are written before the root. Per-package staging uses atomic rename; a filesystem failure can leave already written dependencies, which an identical retry can reuse.

Publication preparation writes static `manifest.json`, metadata and the exact `bundle.json` closure. Upload these through the chosen hosting workflow. Verification fetches the real URL, checks lengths, transport hashes, package fingerprints and dependency completeness before recording a publication. The current verification budget is 512 MiB total and 256 MiB per bundle; query runtime capacities for the actual limits.

Bundled exports include code/resources for offline reading. Remote delivery requires verified exact locators and network access; it does not select newer versions silently.

## Storage and compatibility

The default library is `~/.showai`, overridable by `SHOWAI_HOME`. Project packages are projected under `projects/<projectId>/packages/`; shared packages under `packages/`, and verified publication receipts under `publications/verified/`. Current content is authoritative in transactional SQLite, with readable workspace projections. See [Content library](versioned-library.md).

Legacy `user` packages appear as `global`; old flat templates read as `0.0.0-legacy`. Derive and lock legacy dependencies before promotion/publication. Original fingerprints remain intact.

Implementation entrypoints: [catalog](../src/core/catalog.ts), [merge](../src/core/catalog-merge.ts), [publication](../src/core/publication.ts), [package types](../src/components/custom/types.ts) and [node contract](../src/components/custom/contract.ts).

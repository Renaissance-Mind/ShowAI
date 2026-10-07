# Use ShowAI from an Agent

ShowAI's Node.js CLI and optional MCP server operate on the same project files as the desktop workbench. The CLI runs one command and exits; the desktop window can be closed and no Core daemon is required. It is built from `src/agent/cli.ts` and packaged at `dist-runtime/scripts/cli.mjs`, and included in the desktop application under `Resources/runtime/`. A Python Agent can invoke it with `subprocess` or an MCP client.

The skills-only plugin resolves the installed software from `agent-runtime.json` in the selected content directory, then verifies it with `runtime info --json`. Desktop startup records its bundled launch; standalone runtime users run `runtime register --json`.

In the examples below, `showai` means the verified external command prefix, for example `node /absolute/path/to/dist-runtime/scripts/cli.mjs`. Do not assume a global npm command exists. Standalone use requires Node.js 22.12+. The desktop application's **Settings → Connect Agent** panel provides its bundled executable, CLI path and environment for use without a separate Node installation.

## Choose a usage path

The [use-showai entry skill](../plugins/showai/skills/use-showai/SKILL.md) explains the content model, runtime discovery, object ownership and which specialist skill to read for each task. Read it on first use or when those foundations are unclear. `show-document` handles concrete page creation and presentation; component and template workflows have their own skills. The [runtime reference](../plugins/showai/skills/use-showai/references/runtime.md) explains how to invoke the registered command. Detailed operation instructions come from the executable:

```sh
showai guide --json
showai guide workspace --json
showai guide catalog --json
```

Choose one topic for the current operation: `workspace`, `authoring`, `containers`, `whiteboard`, `document`, `catalog`, `templates`, `versions`, `export` or `publish`. `containers` explains recursive Page/Board roots, frames and views; `document` explains rich-text blocks inside regions and legacy v1 sources; it is only needed when authoring blocks directly. Catalog summaries and command receipts include a useful next step.

Every successful `--json` command returns `{ "ok": true, "data": ... }`. Failures return `{ "ok": false, "error": { "code", "message", "currentHash"? } }` and a nonzero exit code (`3` for page conflicts).

## Page and Board containers

New resources use artifact v3 and default to Page. Use `pages create --kind board` for a spatial workspace. `showai guide containers --json` describes recursive surfaces, parent-owned frames, per-surface views and drawing nodes. Content lives in the tree, frames in layout and saved views in surfaceViews. The project folder parentId differs from a content operation's container parentId.

Page and Board are native entries in the component catalog. Read `catalog read page --view guide` or the Board equivalent. `component.insert` takes kind, data and optional parentId for both ordinary and native components; native insertion preserves the surface node and recursively remaps content and views. Native containers are customized through content/layout and templates.

`surface.create` inserts a Page or Board, and `surface.wrap` wraps an existing surface while preserving its identity and descendants. Block operations edit the tree; surface.layout.set changes frames; view and reading-order operations accept a surfaceId. Supply the current base hash and, for versioned libraries, the resource revision. surface.upgrade adapts older sources and the first managed save preserves original bytes and snapshots.

Template application preserves container kind. Add `--page PAGE --base-hash HASH --base-revision REVISION`, optionally `--parent SURFACE_ID`, to insert its root as a module. Every node, layout key and view reference is remapped together. Export selection may target any nested surface; it includes descendants and necessary ancestors.

## Select the current project

Storage defaults to `~/.showai`. `--home /absolute/library` specifies the content library directory; `SHOWAI_HOME` supplies that directory in the launch environment.

```sh
showai projects current --json
showai projects current --source-directory /absolute/host-project --json
showai projects current --project PROJECT --json
showai pages create --title "A research report" --json
```

A user-specified project takes priority. Otherwise `projects current` resolves or creates the ShowAI project for the host project directory. An explicit `--source-directory` is used exactly; without it, the CLI finds the nearest Git root above cwd, or uses cwd outside Git. Directories resolve to real absolute paths, so symbolic-link aliases share the same project. Different sessions in the same directory share one project, and concurrent first use creates only one. The response includes `home`, `project`, `sourceDirectory`, `resolution` and `created`.

Page, component, template and MCP commands use the same directory resolution when `--project` is omitted. Explicit `projects create` remains available for a requested independent project; subsequent commands select it with `--project`. Session bindings remain metadata and do not choose the default destination. An archived directory project produces a conflict instead of creating a replacement.

Ordinary research, comparison and report tasks default to one resource Page. Organize its chapters with regions, navigation, collapsible content and nested containers, and continue revisions in the same page. Create multiple resource pages for a requested website or separate documents. Displaying multiple excerpts does not create multiple stored pages.

## Discover resources, then request one view

Search with a query and a small limit before inspecting individual resources:

```sh
showai catalog list --kind component --query chart --project PROJECT --limit 5 --json
showai catalog list --kind template --query research --project PROJECT --limit 5 --json
showai catalog describe chart --kind component --view guide --project PROJECT --json
showai catalog describe chart --kind component --view schema --project PROJECT --json
showai catalog describe chart --kind component --view examples --project PROJECT --json
```

A list returns `{ items, total, limit, nextCursor, next }`; the default limit is 20 and the maximum is 50. Pass the returned cursor with the same query and scope to continue. If the catalog changes, restart without a cursor.

Lookup uses the selected project, then global and published libraries, with built-ins as fallback. Use `--scope project|global|published|builtin` and an exact `--version`/`--integrity` when selecting a particular revision. Discovery does not include default data, schemas, code, runtime HTML, or full template documents.

| View                | What is returned                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `summary` (default) | Identity and scope; component purpose/scenarios/effects, or template scenarios                     |
| `guide`             | Usage guidance, component node shape, or template content guide and related resources              |
| `schema`            | Component props schema, or the template-definition input shape                                     |
| `examples`          | Relevant examples and, for components, default data                                                |
| `dependencies`      | Exact dependencies and revision ancestry                                                           |
| `source`            | Explicit original component code or template definition                                            |
| `full`              | Descriptive metadata, schema/examples/dependencies; source and executable runtimes remain excluded |

For a custom component, source view returns its entry code and an index of files. Read one additional file or request the complete original package explicitly:

```sh
showai catalog describe value-slider --scope project --project PROJECT --view source --json
showai catalog describe value-slider --scope project --project PROJECT --view source --file index.tsx --json
showai catalog describe value-slider --scope project --project PROJECT --view source --file '*' --out component-source.json --json
```

Built-in renderer source is maintained in the ShowAI repository. Compiled-only imported components can render, but require their original source package before source editing or merging.

## Edit pages safely

```sh
showai pages create --project PROJECT --input page.showai.json --json
showai pages read PAGE --project PROJECT --json
showai pages diff PAGE --project PROJECT --since PREVIOUS_HASH --json
showai pages apply PAGE --project PROJECT --input operations.json --base-hash CURRENT_HASH --base-revision CURRENT_REVISION --json
showai pages save PAGE --project PROJECT --input revised.showai.json --base-hash CURRENT_HASH --base-revision CURRENT_REVISION --json
```

Read before writing, retain stable block ids and inspect user changes against the previous checkpoint. On `CONFLICT`, read again and merge deliberately; do not reuse an old full-document replacement with a newer hash. The authoring guide gives operation shapes, while the document guide covers the JSON tree. An input path of `-` reads JSON from stdin.

Custom references are locked to exact version and integrity when pages are written. Importing an artifact's bundled or remotely verified runtimes installs them into the selected project and rebinds matching references there; it does not change shared libraries.

## Project versions, forks and merges

New authoring work belongs to a project. Global, published and built-in revisions are shared and immutable. Import or save a new project revision first:

```sh
showai catalog import --project PROJECT --input ./component-package --json
showai catalog save --project PROJECT --input component-source.json --json
```

A source input contains the original `manifest`, `schema`, `source`, optional `files` and `assets`; a response from `--view source --file '*' --out ...` can be used after editing its `source` object. Existing id/version content cannot be replaced. Increase the version for subsequent changes.

Catalog results provide exact refs with `kind`, `id`, `version`, `integrity`, `scope` and, for project revisions, `projectId`. Save a selected ref to a JSON file for these commands:

```sh
showai catalog fork --project PROJECT --input ref.json --id my-variant --version 1.0.0 --json
showai catalog promote --project PROJECT --input ref.json --to global --json
```

Promotion requires explicit `--to global`. It registers an immutable revision and its dependencies in the local shared library; it does not upload anything.

Three-way merge input contains exact `base`, `ours` and `theirs` refs. Preview is read-only and returns conflict paths by default. Save the full candidate to a file for review:

```sh
showai catalog merge preview --project PROJECT --input merge-input.json --out merge-preview.json --json
showai catalog merge resolve --project PROJECT --input resolved-merge.json --json
```

The resolution file contains the same refs, a new `version`, optional `id`, and `resolved` copied from the reviewed preview's editable package with conflicts resolved. `--view source` explicitly returns the complete preview to the caller. The result is a new project revision; no parent revision is overwritten.

## Basic components and code composition

The Markdown component (`text`) combines headings, paragraphs, lists, quotations, code blocks and dividers in one content string. Images (`image`) and tables (`table`) have dedicated components for their editing, layout and appearance features. Foldable content (`toggle`) and interactive/custom components use their own kinds. Each kind uses the same page node envelope:

````json
{
  "type": "widget",
  "attrs": {
    "kind": "text",
    "data": {
      "content": "## Main finding\n\nDescribe the evidence.\n\n> **Note:** check the inputs.\n\n```javascript\nconst result = input * 2;\n```\n\n---\n\n- Explain the result\n- Link supporting evidence",
      "format": "markdown",
      "color": "#30382e"
    }
  }
}
````

Request `--view schema` and `--view examples` for the selected kind. `--view source` returns an editable starting package for builtins as well as custom components. Choose your own manifest ID and version, edit the source or default data, then save to an explicit project. Appearance fields include color, background, alignment, padding, radius and, for text, font size. Image components support dimensions, fit, alt text and captions; simple tables use a string column array and rectangular rows of scalar cells.

Custom React components can compose builtins directly:

```tsx
import { Markdown, Image, Table } from "showai:components";

export default function Figure({ data, onChange, readOnly }) {
  return (
    <section>
      <Markdown
        data={data.text}
        readOnly={readOnly}
        onChange={(text) => onChange?.({ ...data, text })}
      />
      <Image
        data={data.image}
        readOnly={readOnly}
        onChange={(image) => onChange?.({ ...data, image })}
      />
      <Table
        data={data.table}
        readOnly={readOnly}
        onChange={(table) => onChange?.({ ...data, table })}
      />
    </section>
  );
}
```

Components that handle scrolling or zoom can import `GestureBoundary` from `showai:components` and set `axes={["x"]}`, `["y"]`, `["zoom"]` or a combination. Claim only the input axes needed by that interaction.

The SDK also exports `Callout`, `Toggle`, `Divider`, `Code`, `Chart`, `Database`, `Metrics`, `Playground`, `Gallery`, and `Bookmark`. Package-local React modules can nest normally. To reuse an existing custom component, declare its exact component ref in `manifest.dependencies`, then import its default export from `showai:component/ID`. The child must have verified editable source available in the selected project or shared catalog. Pass `readOnly` and connect child `onChange` callbacks to the parent's data; each child validates its own schema. The parent schema should define the complete data it stores, including nested child data.

Composition is compiled into the parent's runtime and works in desktop, offline HTML and inline conversation exports. Global registration and publication preserve all exact dependency sources. Cycles, missing fingerprints, imports outside a package, and compositions deeper than 16 levels are rejected. Nesting is authored in code.

## Templates and composition

A template can be saved from an existing page or from explicit metadata and composition:

```sh
showai template save --project PROJECT --page PAGE --name "Report structure" --version 1.0.0 --json
showai template save --project PROJECT --input template-definition.json --json
showai template apply TEMPLATE_ID --project PROJECT --version VERSION --title "My report" --json
```

A template definition includes `name`, `description`, optional `id`/`version`, `scenarios`, `contentGuide`, `related`, `examples`, and either `document` or `composition`. Query the template guide for usage and source view only when editing its definition.

The `create-template` skill can refine a concrete page before abstracting it, or save a template definition directly and apply it to a preview page. For direct creation, offer relevant natural-language usage prompts when the structure needs a choice, then implement the selected direction. Store these prompts in `examples.request` with a `name` and `steps`; use `contentGuide` for required materials, organization and optional sections. Both workflows validate an applied page. Reusable feedback creates a new template version; instance edits remain in the page. See [skill workflows](skills.md).

Composition parts are `{ "type": "content", "content": DOC_NODE }` or `{ "type": "template", "ref": EXACT_REF, "title": OPTIONAL_TITLE }`. The core locks references, checks the dependency graph, and expands composed templates when creating a page. `--view dependencies` exposes the pinned graph. Applying a template creates independent page and block identities.

## Deliver locally or prepare a publication

```sh
showai export --project PROJECT --page PAGE --format html --components bundled --out ./report.html --json
showai export --project PROJECT --page PAGE --format inline --components bundled --out ./report-inline.html --json
showai export --project PROJECT --page PAGE --blocks PROGRESS_BLOCK_ID --format inline --out ./progress-inline.html --overwrite --json
showai export --project PROJECT --format site --components remote --out ./site --json
```

Full-page export defaults to `--presentation spatial`. Use `--presentation reading` for a responsive document-style projection in reading order. Both full-page modes retain the same complete v2 editable source.

For partial visualization, pass `--blocks ID,ID` with html or inline. IDs identify page node instances (`attrs.id` from `pages read`), rather than catalog packages or children internal to component code. A selected region includes its descendants; multiple selections preserve page order and necessary ancestor containers without duplicates. Partial exports default to reading presentation and hide the page title. Explicit spatial presentation retains whiteboard positioning. Only selected content and its referenced runtimes enter the HTML and companion JSON. The stored page is unchanged; the partial JSON must not replace it. Site export rejects block selection.

After creating, organizing or revising a ShowAI page, save the complete page using its current hash and revision, export inline, and include the host's actual display reference in the final reply by default. This applies to standalone-page tasks as well. Codex uses its current visualize fragment/path/output-reference contract with the returned absolute path; ShowAI defines the delivery step. Open a preview for verification and optionally provide the full HTML link. See [conversation display](../plugins/showai/skills/show-document/references/conversation-display.md). For focused revision results or automated progress updates, export the relevant stable block IDs. MCP `page_export` accepts the equivalent `blockIds` array.

Bundled is the default. The reader, content and exact custom runtimes travel together; raster images must be embedded for offline delivery. HTML and inline exports also save editable source JSON. A static site includes relative navigation, source files and shared reader assets, and is intended for HTTP/static hosting. Whole-project export omits archived pages.

HTML and inline export compile the selected page's native components and dependency closure from the software's fingerprinted reader archive. G2 exports include selected drawing functions and their required libraries; site export uses the union across pages and shares the reader. `runtime info.readerCompilation.mode` reports `page-dependencies` when this capability is installed; `prebuilt` means a legacy/template reader is in use. Explicit viewer templates remain supported.

Inline is a UTF-8 fragment for a host-supported visualization surface and its final emitted size must remain under 1 MB. It requires bundled components and compresses oversized reader code, styles and artifact losslessly before checking the limit. Full HTML file size does not determine inline size. Component packages and the companion source retain their full contents and identities. A terminal or generic MCP client does not acquire HTML display simply by connecting ShowAI. Desktop/ordinary HTML use component iframes; conversation inline mode uses the host's whole-page sandbox with per-component Shadow DOM styles.

When a full report exceeds the inline limit, show meaningful selected blocks or a few ordered excerpts and link the full HTML report. Keep one complete source page. If the host lacks conversation HTML rendering, deliver an available preview/file and state where the result is shown. Omit the default conversation preview only for an explicit save-only, file-only, panel-only or background request.

Remote delivery uses previously verified exact component locators and requires network access when reading. The HTML does not silently choose a newer version. Prepare and register published files explicitly:

```sh
showai publish prepare --project PROJECT --input publication-refs.json --out ./publication --json
showai publish verify --project PROJECT --url MANIFEST_URL --json
showai publish list --limit 20 --json
```

The input is an exact-ref array or `{ "refs": [...] }`. `prepare` only writes local static files. Uploading them to a chosen host is a separate, explicitly requested operation. `verify` fetches the manifest and runtime bytes, validates them and registers the release in the local shared published library; `register` is an alias that performs the same verification. Pure-template releases are included in the publication list even when they have no component runtimes. These commands do not themselves upload a public website.

Existing exports require `--overwrite`. Project sources and shared catalog/publication metadata are protected against output-path aliases and symbolic links. The selected project's `exports/` subtree is an allowed destination.

## Install, update and connect

From the source repository:

```sh
npm run plugin:install
npm run plugin:update
```

These validate and install the skills-only plugin through official Codex commands, compare installed skill bytes and confirm it is enabled. The runtime is built and installed separately. The receipt is `artifacts/codex-plugin-install.json`. Start a new Codex conversation after success. No desktop rebuild, Git pull, automatic uninstall or application restart is performed. See [the plugin README](../plugins/showai/README.md) for release bundles.

Claude Code uses the repository's marketplace after `npm run build`:

```sh
claude plugin marketplace add ./
claude plugin install showai@renaissance-mind
```

The optional MCP server is a subprocess fixed to one existing project:

```sh
codex mcp add showai-PROJECT -- node /absolute/path/ShowAI/dist-runtime/scripts/cli.mjs mcp --project PROJECT
claude mcp add --transport stdio --scope local showai-PROJECT -- node /absolute/path/ShowAI/dist-runtime/scripts/cli.mjs mcp --project PROJECT
```

Use `guide`, `project_context`, `catalog_list` and view-aware `catalog_describe` for discovery. Page editing, project component/template creation, fork/merge and local publication preparation use the same operations as CLI. Project-bound MCP cannot promote to global, register a published release or write another project's catalog; use an explicit CLI or desktop action for shared-library changes. Protocol JSON uses stdout and diagnostics use stderr.

For a desktop installation without Node.js, use the launch configuration copied from Settings. On a standard macOS installation the executable can run the bundled CLI as follows:

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/ShowAI.app/Contents/MacOS/ShowAI" \
  "/Applications/ShowAI.app/Contents/Resources/runtime/scripts/cli.mjs" \
  projects list --json
```

Copy the configured `SHOWAI_HOME` too when the desktop application uses a non-default library. Other operating systems use the actual paths returned by Settings.

A Python Agent can invoke the same CLI directly:

```python
import json
import subprocess

result = subprocess.run(
    ["node", "/absolute/path/ShowAI/dist-runtime/scripts/cli.mjs", "guide", "catalog", "--json"],
    check=True, capture_output=True, text=True,
)
guide = json.loads(result.stdout)["data"]
```

## Versioned libraries and recovery

New empty homes initialize versioned storage automatically. Existing file libraries require a reviewed `library import` and `library activate`, or `library migrate` in place; original files and old checkpoints remain retained. Old checkpoints have unknown original edit times, actors and order.

Keep `hash`, `revision` and stable node IDs from a full read. Supply both `--base-hash` and `--base-revision` for save/apply and template insertion. Use `--operation-id` only when retrying the same request; `--message` and `--group` describe purpose and continuous edits. Agent attribution uses the actual harness/session when available (including `CODEX_THREAD_ID`); missing provenance is explicitly unknown.

`history list/read/compare/merge/restore` exposes independent changes, actor/session filters and reviewed three-way merges. `history read --view html` and `export --revision` use the captured reader and pinned dependencies. `history imported/snapshot/restore-snapshot` handles old checkpoints separately. `search --query` searches bodies, nested containers, component/template descriptions and sources.

`history conflicts` discovers external files. `history recover-package CONFLICT_ID --project PROJECT` retains edited source/schema/assets as an editable draft and restores the immutable package projection. Repair the draft and publish a new version. `library stats/compact/cleanup-plan/cleanup/rebuild-index/archive/verify-archive/policy` exposes space accounting and verified maintenance; cleanup never removes formal history.

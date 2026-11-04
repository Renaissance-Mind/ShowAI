# Template folders and the presentation workflow

**Language:** English | [简体中文](i18n/template-bundles.zh-CN.md) · [Documentation](README.md)

A ShowAI template packages a reusable presentation method for one kind of content, plus an optional component library. The runtime supplies the mandatory presentation workflow; the selected template adds the methods for its kind of content and does not repeat the workflow. The same contract serves local Codex/Claude Code connections and authorized HTTP MCP clients.

## Presentation workflow

Every work moves through seven stages. Each stage answers one question and hands a record to the next.

| Stage     | Question answered                                                                     | Record                                                                 |
| --------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Intent    | What does the reader actually want to know, know already, lack or misunderstand?      | Reader brief                                                           |
| Material  | Which facts and numbers are needed, where do they come from, under which conditions?  | Source notes (optional for generic topics)                             |
| Logic     | What is explained, in what order, to what depth?                                      | Multi-level presentation plan                                          |
| Design    | Which environment, overall layout, visual expression, text placement and interaction? | Scene-by-scene design draft, as specific as an image-generation prompt |
| Authoring | How does each scene become Page content?                                              | Block IDs added to each scene of the draft                             |
| Review    | Does the saved Page support the reader brief and the draft?                           | Review record                                                          |
| Delivery  | Where does the reader open the work, and what remains unverified?                     | Presented Page                                                         |

The built-in `system-presentation` template is the source of this workflow. Its README lists the stages and the visual principles: design the whole and each part, prefer pictures, draw state in mechanism diagrams, let text complete the picture, keep text readable. Its guides describe each stage. A task template adds the methods for its content type, for example how a paper explainer collects numbers with their conditions and which scene designs have worked.

## Folder format

```text
my-template/
  README.md
  guides/                     # listed in README, read in that order
    reader.md
    scenes.md
  components/                 # may be empty
    sequence/
      manifest.json
      props.schema.json
      index.tsx
```

README.md begins with JSON frontmatter between `---` lines, followed by a short Markdown body. JSON is used as a strict, portable frontmatter format; YAML-only syntax and unknown metadata fields are rejected. This metadata is authoritative: explicit save options must agree with it.

```text
---
{
  "format": "showai-template",
  "schemaVersion": 4,
  "id": "my-template",
  "name": "My template",
  "version": "1.0.0",
  "description": "Explain a mechanism with visible objects and feedback.",
  "scenarios": ["Read a mechanism and its evidence."],
  "guides": ["guides/reader.md", "guides/scenes.md"],
  "components": []
}
---

# My template

Describe what the template produces, how it works through the stages for this kind of content, and when not to use it.
```

`guides` lists the guide Markdown files under `guides/` in reading order, at most 20, and may be empty. An agent reads the selected template whole, once, so the guides hold only the methods this kind of content needs, organized however suits that content; the stages and their records come from the system workflow. The README body is limited to 4 KiB, each guide to 32 KiB and all guides together to 48 KiB. Component lists may be empty. Applying a template always creates an empty Page: the logic and design records of the current instance decide the page structure, not a stored skeleton.

Earlier staged bundles remain readable. `schemaVersion` 3 mapped the four stages intent, material, logic and design to guides. `schemaVersion` 1 and 2 declared six stages (intent, evidence, understanding, design, authoring, review), and `schemaVersion` 1 could carry a `page.json` skeleton. `template_context` returns their stage guides in stage order; six-stage bundles disclose their intent, evidence, understanding and design guides and leave out authoring and review. New templates use `schemaVersion` 4.

Every task context includes the `system-presentation` reference. Its README and guides are embedded in the `show-document` Skill from the same source, and hosts without local Skill files read the same text with `guide({topic:"presentation"})`. A project template cannot replace or disable `system-presentation`. Template guides are read through `template_context`; they are not installed as Skills.

## Builtin templates

| ID                    | Purpose                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system-presentation` | The mandatory presentation workflow: seven stages, their records and the visual principles                                                                                      |
| `paper-explainer`     | Interactive explanation of a paper: starts from background and motivation and builds up step by step, problem → mechanism → evaluation setup → evidence → conditions and limits |
| `blank`               | Studio-only source for the "new page" button; not listed in agent catalogs                                                                                                      |

`paper-explainer` was distilled from two verified explainer pages (VideoJev, Terminal-RSI). Its design guide names the component capabilities by reader task; when a project or global copy of the template carries the matching component library, `template_context` returns exact references, otherwise the guide lists builtin alternatives.

## Component library

Each declaration is `{ "id": "sequence", "path": "components/sequence" }`. Its manifest uses that local ID and the existing component contract: exact version, entry, default data, schema, examples and versioned usage/development documentation. Text files and base64 image/font assets travel with the package. Local component dependencies declare local IDs and exact versions; registration resolves their fingerprints. External dependencies retain exact references.

Saving/importing a template compiles its component library through the existing compiler and assigns isolated IDs. Two different templates may declare the same local ID. The resulting components are immutable project revisions: update a component version when its code changes. Guides and package structure have their own template version. Context lookup returns the actual component references; do not guess generated IDs or register the same package again during reading.

Directory import rejects symlinks, path traversal, unsafe names and case-insensitive collisions. Both directory and network payloads pass the same validator. Bundles contain at most 200 files, 30 components and 16 MiB. A `template_context` response has a 64 KiB budget; when the selected templates exceed it, select fewer templates or shorten their guides. Responses do not silently truncate guide content.

## MCP workflow

1. Check `showai_capabilities.templateWorkflow.protocol` for `showai-template-workflow-v3`; resolve the actual authorized project.
2. Read the presentation workflow once. The loaded `show-document` Skill contains it; hosts without Skills call `guide({topic:"presentation"})`.
3. Choose a template from `catalog_list({kind:"template",projectId})` by its scenarios, or work without one. `template_context({projectId,templates:[{id,scope,version?,integrity?}]})` returns each selected template's README, every guide and a paged component index with exact references. Read it whole, once, and apply its methods at each stage. Use `knownHash` only for an already held context. Follow `componentPage.next` when more component entries are needed.
4. Write the stage records into one folder per work under the directory returned by `showai_capabilities.authoring.workRecords`: `brief.md` (reader brief), `material.md` (source notes), `presentation-plan.json` (the plan as `nodes`, the design draft as `scenes`) and `review.md` (review record). Before the first write to the Page, check the plan with `scripts/check_plan.py` from the `show-document` Skill. Remote connections without a file system keep the records in the conversation.
5. Apply the template with `template_apply` (an empty Page bound to the exact refs), or use the user's blank-page choice; author the Page from the design draft.
6. Read/edit/save using current source hash and revision, then present the saved Page. `page_read(response:"source")` returns complete source without duplicate Markdown/outline; image/identity checks and page writes can use `response:"receipt"`.

Template application records `Page.templateContext`, preserving exact workflow references for continued editing. Explicit page changes may set this field through `page.set`; the value contains `format`, `system` and `templates`, without a context response hash. Stored references document the workflow, not permission to access another project. Missing older template records must be reported or imported, not replaced with a guessed latest version.

No library-wide current template is mutated. Templates are already registered at save/import. Local MCP startup may pin defaults for one bound project; HTTP/library clients carry explicit references on each `template_context` call. Omitting `templates` uses that connection's startup defaults; explicit `templates:[]` clears task-template selection for the call and keeps only the system workflow reference. Known hashes never bypass authorization or exact-reference lookup.

The directory-shaped network input is `template_save({projectId,input:{bundle:{format:1,files,assets?}}})`. `files` maps relative paths to UTF-8 text; `assets` maps component asset paths to base64. A web client does not pass server-local directories. Legacy document/composition/contentGuide templates and exact old revisions remain readable.

Anonymous standalone clients can use the builtin folder templates through `public_catalog_list/describe`; a describe request may specify `version` and `integrity`, and `view:"guide"` returns a template's README and every guide. The system workflow template is public. `render_document` can instantiate a folder template with `templateId`, `templateVersion` and `templateIntegrity`, or render an explicit customized document. Project templates and registration still require authorized project access.

## Local management and host packages

```sh
showai template import ./my-template --project PROJECT --json
showai template export my-template --project PROJECT --out ./new-folder --json
showai template context --project PROJECT --templates my-template@1.0.0 --json
showai mcp --project PROJECT --templates my-template@1.0.0
```

Startup `--templates` requires a bound `--project`; library and HTTP connections select with tools. CLI import/export manages local folders; Agent document operations use MCP. Plugin launch also accepts `SHOWAI_TEMPLATES` together with `SHOWAI_PROJECT_ID`, without changing the registered library runtime or other sessions.

The plugin shares the same skills and launcher across Codex and Claude Code. Packaging supplies Codex `plugin.json`/`mcp.json` and Claude Code `.claude-plugin/plugin.json`/`.mcp.json`. Remote packages replace the transport with the configured HTTPS endpoint. ChatGPT web clients read the presentation workflow and template guides through that endpoint and use its OAuth/project grants; they do not require a local plugin directory. Updating a skill package does not update an already running application or MCP server. The launcher checks the workflow protocol and reports an incompatible runtime before use.

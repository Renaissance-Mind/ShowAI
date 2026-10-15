# Template folders and staged presentation

**Language:** English | [简体中文](i18n/template-bundles.zh-CN.md) · [Documentation](README.md)

ShowAI templates package a reusable method, an optional page skeleton and optional custom components. The runtime supplies the mandatory system presentation baseline; the selected template adds instructions for the current stage. The same contract serves local Codex/Claude Code connections and authorized HTTP MCP clients.

## Folder format

```text
my-template/
  README.md
  guides/
    01-intent.md
    02-evidence.md
    03-understanding.md
    04-design/README.md
    04-design/detail.md
    05-authoring.md
    06-review.md
  components/                 # may be empty
    sequence/
      manifest.json
      props.schema.json
      index.tsx
  page.json                   # optional
```

README.md begins with JSON frontmatter between `---` lines, followed by a short Markdown body. JSON is used as a strict, portable frontmatter format; YAML-only syntax and unknown metadata fields are rejected. This metadata is authoritative: explicit save options must agree with it.

```markdown
---
{
  "format": "showai-template",
  "schemaVersion": 1,
  "id": "my-template",
  "name": "My template",
  "version": "1.0.0",
  "description": "Explain a mechanism with visible objects and feedback.",
  "scenarios": ["Read a mechanism and its evidence."],
  "guides":
    {
      "intent": "guides/01-intent.md",
      "evidence": "guides/02-evidence.md",
      "understanding": "guides/03-understanding.md",
      "design": "guides/04-design",
      "authoring": "guides/05-authoring.md",
      "review": "guides/06-review.md",
    },
  "components": [],
  "page": null,
}
---

# My template

Describe the reusable task and the materials supplied by each instance.
```

Declare all six stages. A stage value is a Markdown filename, a folder with a main README.md, or `null` to inherit the system stage. The basic README body is limited to 4 KiB; a guide file to 32 KiB. Move detail into explicitly requested guide files. Component lists may be empty. A page skeleton, when present, uses the current Page/Board format; omitting it creates an empty editable Page on application.

The system baseline is always included in task contexts and embedded in the foundational `show-document` skill from the same authoritative source. A project template cannot replace `system-presentation`. The runtime provides the baseline through `guide({topic:"presentation"})` for hosts without local skill files. Stage guides are requested when needed, not globally installed as one skill per file.

Template composition remains available in the legacy definition format. It is an optional structural capability, not a required step in each stage.

## Component library

Each declaration is `{ "id": "sequence", "path": "components/sequence" }`. Its manifest uses that local ID and the existing component contract: exact version, entry, default data, schema, examples and versioned usage/development documentation. Text files and base64 image/font assets travel with the package. Local component dependencies declare local IDs and exact versions; registration resolves their fingerprints. External dependencies retain exact references.

Saving/importing a template compiles its component library through the existing compiler and assigns isolated IDs. Two different templates may declare the same local ID. The resulting components are immutable project revisions: update a component version when its code changes. Guides and package structure have their own template version. Context lookup returns the actual component references; do not guess generated IDs or register the same package again during reading.

Directory import rejects symlinks, path traversal, unsafe names and case-insensitive collisions. Both directory and network payloads pass the same validator. Bundles contain at most 200 files, 30 components and 16 MiB; context and combined stage text have 64 KiB response budgets. Oversized instructions must be split or requested per selected template. Responses do not silently truncate guide content.

## MCP workflow

1. Check `showai_capabilities.templateWorkflow.protocol` for `showai-template-workflow-v1`; resolve the actual authorized project.
2. Read the system baseline, or reuse the exact baseline embedded in the loaded skill.
3. `template_context({projectId,templates:[{id,scope,version?,integrity?}]})` returns READMEs, pinned references and a paged component index. Use `knownSystemHash` only for baseline text already read. Use `knownHash` only for an already held context. Follow `componentPage.next` when more component entries are needed.
4. `template_guide({projectId,stage,templates:context.templates})` returns that system stage plus the selected exact-template guides. For a stage folder, use its listed filenames with `templateId` and `file` to read one subfile. Cached guide hashes can suppress repeated text.
5. Apply a matching template with `template_apply`, or use the user's blank-page choice. Fill real content and validate the relevant states. Templates do not automatically research or bind materials.
6. Read/edit/save using current source hash and revision, then present the saved Page. `page_read(response:"source")` returns complete source without duplicate Markdown/outline; image/identity checks and page writes can use `response:"receipt"`. The default `full` profile remains compatible. Request full/rendered information when inspecting derived values.

Template application records `Page.templateContext`, preserving exact workflow references for continued editing. Explicit page changes may set this field through `page.set`; the value contains `format`, `system` and `templates`, without a context response hash. Stored references document the workflow, not permission to access another project. Missing older template records must be reported or imported, not replaced with a guessed latest version.

No library-wide current template is mutated. Templates are already registered at save/import. Local MCP startup may pin defaults for one bound project; HTTP/library clients carry explicit references on each stage call. Omitting `templates` uses that connection's startup defaults; explicit `templates:[]` clears task-template selection for the call while retaining system instructions. Changing one client's selection does not change another client's task. Known hashes never bypass authorization or exact-reference lookup.

The directory-shaped network input is `template_save({projectId,input:{bundle:{format:1,files,assets?}}})`. `files` maps relative paths to UTF-8 text; `assets` maps component asset paths to base64. A web client does not pass server-local directories. Legacy document/composition/contentGuide templates and exact old revisions remain readable.

Anonymous standalone clients can use the builtin folder templates through `public_catalog_list/describe`; a describe request may specify `stage`, `version` and `integrity`. The system baseline is public. `render_document` can instantiate a folder template with `templateId`, `templateVersion` and `templateIntegrity`, or render an explicit customized document. Project templates and registration still require authorized project access.

## Local management and host packages

```sh
showai template import ./my-template --project PROJECT --json
showai template export my-template --project PROJECT --out ./new-folder --json
showai template context --project PROJECT --templates my-template@1.0.0 --json
showai template guide design --project PROJECT --templates my-template --json
showai mcp --project PROJECT --templates my-template@1.0.0
```

Startup `--templates` requires a bound `--project`; library and HTTP connections select with tools. CLI import/export manages local folders; Agent document operations use MCP. Plugin launch also accepts `SHOWAI_TEMPLATES` together with `SHOWAI_PROJECT_ID`, without changing the registered library runtime or other sessions.

The plugin shares the same skills and launcher across Codex and Claude Code. Packaging supplies Codex `plugin.json`/`mcp.json` and Claude Code `.claude-plugin/plugin.json`/`.mcp.json`. Remote packages replace the transport with the configured HTTPS endpoint. ChatGPT web clients read the system and stage instructions through that endpoint and use its OAuth/project grants; they do not require a local plugin directory. Updating a skill package does not update an already running application or MCP server. The launcher checks the workflow protocol and reports an incompatible runtime before use.

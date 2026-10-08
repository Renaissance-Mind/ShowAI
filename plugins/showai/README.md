# ShowAI Agent plugin

This package distributes shared workflows for independent presentations and local or synchronized projects. Use an installed ShowAI runtime for CLI/stdio, or a connected HTTP MCP service. Display and synchronization are independent: a text-only Agent can update a shared project, while public components, templates and customization can be used without a private project or login.

Start with [cross-host integration](skills/use-showai/references/integration.md). `showai_capabilities` (MCP) or `runtime info` (CLI) reports actual capabilities. For remote distribution, `npm run package:plugin -- --mcp-url HTTPS_MCP_URL --out NEW_DIRECTORY` packages the same skills with the selected endpoint; no credentials enter the package.

| Skill | When it applies |
| --- | --- |
| `use-showai` | Learn the foundations, connect the runtime, locate or read existing content, inspect history, and choose the appropriate workflow. |
| `show-document` | Create, revise, present or export a specific page, report or small site; apply an existing template. |
| `create-component` | Build or adapt a reusable component when reuse and composition leave a real gap. |
| `create-template` | Create or revise a reusable template, either directly or by abstracting a page. |

Begin with [use-showai](skills/use-showai/SKILL.md) when first using ShowAI or when the operation, runtime or object ownership is unclear. Its task table routes reading, searching, displaying, authoring, component development, template creation and history operations. A directly selected specialist skill links back to this guide only when foundational information is missing; known context can be reused.

The unified guide explains the content model, remote MCP discovery and when a local path needs the [external runtime configuration](skills/use-showai/references/runtime.md). Once an executable is known, query `runtime info --json` to verify the actual library and needed capabilities. Load only the relevant CLI guide and selected catalog views. Skills do not install the executable or identify an unknown custom library automatically.

`create-template` supports two workflows. With source material or a page to refine, create and iterate a concrete page, then abstract its reusable structure while preserving the original. With a clear recurring use case, offer natural-language usage prompts, save the selected template definition directly, then apply it to a preview page. Both workflows deliver a saved template, usage prompts in its examples, and an application preview; reusable feedback updates the template, while instance-specific edits stay in the page.

`show-document` can display a complete page or selected page components/regions. Use `export --blocks ID,ID --format inline` for focused conversation updates, or `--format html` for a partial reader. Selection uses page node IDs and preserves the complete stored page. Query `guide export` on the active runtime to confirm block-selection support before using a newly updated skill with an older runtime.

Use a user-specified ShowAI project or page ownership when provided. Reading and searching use existing projects and explicit IDs. New content without an explicit project can resolve or create the project for a trusted host directory with `projects current`; sessions in the same directory share one project. Ordinary reports use one Page with sections; multiple resource pages follow a requested site or separate documents. Creating, organizing or revising a ShowAI page includes inline conversation preview by default. The final reply uses the host's actual rendering reference, unless the user explicitly requests save-only, file-only, panel-only or background execution. Codex follows the current visualize fragment/path/output contract; oversized reports use selected inline previews plus the complete HTML. See [project selection](skills/use-showai/SKILL.md) and [conversation display](skills/show-document/references/conversation-display.md).

From the source repository, use `npm run plugin:install` or `npm run plugin:update`. These prepare the shared skills package, install through official Codex marketplace commands and verify the installed copy byte-for-byte. Start a new chat to load changed skills. Build external software with `npm run build`; register the standalone runtime with `npm run runtime:register`, or use the desktop application's Settings → Connect Agent launch configuration.

Claude Code can register this repository with `claude plugin marketplace add ./` and install `showai@renaissance-mind`. For an extracted plugin bundle, use a marketplace entry pointing at this plugin directory. Install a compatible ShowAI runtime before running its workflows.

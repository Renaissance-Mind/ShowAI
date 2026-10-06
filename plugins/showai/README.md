# ShowAI skills plugin

This package distributes workflows and reference documents. Install ShowAI desktop software or its external CLI runtime separately. The reader, component compiler and runtime dependencies belong to that software, not this plugin.

| Skill              | When it applies                                                                  |
| ------------------ | -------------------------------------------------------------------------------- |
| `show-document`    | Create, revise or export a page, report or small site.                           |
| `create-component` | Build or adapt a reusable component when reuse and composition leave a real gap. |
| `create-template`  | Create or revise a reusable template, either directly or by abstracting a page.  |

The active skill resolves the external launch from the selected content directory's `agent-runtime.json`, validates `runtime info`, and loads only the relevant CLI guide and selected catalog views. Runtime locations and installed components are discovered dynamically.

`create-template` supports two workflows. With source material or a page to refine, create and iterate a concrete page, then abstract its reusable structure while preserving the original. With a clear recurring use case, offer natural-language usage prompts, save the selected template definition directly, then apply it to a preview page. Both workflows deliver a saved template, usage prompts in its examples, and an application preview; reusable feedback updates the template, while instance-specific edits stay in the page.

`show-document` can display a complete page or selected page components/regions. Use `export --blocks ID,ID --format inline` for focused conversation updates, or `--format html` for a partial reader. Selection uses page node IDs and preserves the complete stored page. Query `guide export` on the active runtime to confirm block-selection support before using a newly updated skill with an older runtime.

From the source repository, use `npm run plugin:install` or `npm run plugin:update`. These prepare the skills-only package, install through official Codex marketplace commands and verify the installed copy byte-for-byte. Start a new chat to load changed skills. Build external software with `npm run build`; register the standalone runtime with `npm run runtime:register`, or use the desktop application's Settings → Connect Agent launch configuration.

Claude Code can register this repository with `claude plugin marketplace add ./` and install `showai@renaissance-mind`. For an extracted plugin bundle, use a marketplace entry pointing at this plugin directory. Install a compatible ShowAI runtime before running its workflows.

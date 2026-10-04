# ShowAI skills plugin

This package distributes workflows and reference documents. Install ShowAI desktop software or its external CLI runtime separately. The reader, component compiler and runtime dependencies belong to that software, not this plugin.

| Skill              | When it applies                                                                  |
| ------------------ | -------------------------------------------------------------------------------- |
| `show-document`    | Create, revise or export a page, report or small site.                           |
| `create-component` | Build or adapt a reusable component when reuse and composition leave a real gap. |
| `extract-template` | The user asks to abstract a mature page into a reusable template.                |

The active skill resolves the external launch from the selected content directory's `agent-runtime.json`, validates `runtime info`, and loads only the relevant CLI guide and selected catalog views. Runtime locations and installed components are discovered dynamically.

From the source repository, use `npm run plugin:install` or `npm run plugin:update`. These prepare the skills-only package, install through official Codex marketplace commands and verify the installed copy byte-for-byte. Start a new chat to load changed skills. Build external software with `npm run build`; register the standalone runtime with `npm run runtime:register`, or use the desktop application's Settings → Connect Agent launch configuration.

Claude Code can register this repository with `claude plugin marketplace add ./` and install `showai@renaissance-mind`. For an extracted plugin bundle, use a marketplace entry pointing at this plugin directory. Install a compatible ShowAI runtime before running its workflows.

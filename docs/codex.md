# Use ShowAI with Codex

**Language:** English | [简体中文](i18n/codex.zh-CN.md) · [Documentation](README.md)

The local ShowAI plugin contains seven Skills and a stdio MCP launcher. Codex uses MCP to read, create, edit and present content saved in the selected project. The ShowAI application or standalone runtime provides storage, compilation and the reader; install it separately from the plugin.

## Install and connect

In the desktop App, open **Settings → Agent → Local connection → Install the ShowAI plugin** and click **Install plugin** next to Codex. The same panel installs the Claude Code plugin. Install the host application first; its plugin-management CLI must be available. On macOS, ShowAI also checks the standard Codex app locations for its bundled CLI.

The App supplies the plugin files and executable runtime, so this path requires neither the ShowAI source repository nor a separate Node.js installation. It verifies the installed files and enabled state. The connection uses the current content library; use **Update and enable** after switching libraries or moving the App. Refresh/restart the host to load the new tools. If ShowAI is already enabled from another source, disable that plugin in the host before installing the App version.

For installation from source, use Node.js 22.12+, Codex CLI on `PATH`, and a runtime supporting `showai-mcp-v1`. Start ShowAI once, or run `runtime register --json` with the actual runtime, to record `agent-runtime.json` in the target library.

From the repository:

```sh
npm run plugin:install -- --json
```

After pulling an update:

```sh
npm run plugin:update -- --json
```

The installer uses official Codex plugin commands and checks installed bytes, version and enabled state. See [Plugin documentation](../plugins/showai/README.md).

Installation, host refresh and a conversation loading current tools are separate steps. Use the host's supported refresh/restart procedure, then start a new conversation and confirm the ShowAI tools and seven Skills are visible. An existing conversation may retain older definitions. Call `guide()`, then `showai_capabilities` and `project_context` to establish the actual connection.

## Select a library and project

| Setting                   | Purpose                                              |
| ------------------------- | ---------------------------------------------------- |
| `SHOWAI_HOME`             | Library; defaults to `~/.showai`                     |
| `SHOWAI_PROJECT_ID`       | Optional project binding                             |
| `SHOWAI_TEMPLATES`        | Optional startup templates; requires a bound project |
| `SHOWAI_PRESENTATION_DIR` | Output directory accessible to the host              |

Configure these before starting the MCP process. The local launcher probes only its selected library's registered runtime and reports incompatible versions or connection failures. For HTTP MCP, use the authorized endpoint and returned project identities. See [Agent integration](agent-integration.md).

## Create and continue work

1. **Find the content.** Use `projects_list` or bound `project_context`, then `pages_list`, `library_search` and `page_read`. Read-only lookup does not create projects. For new formal work, respect the user's project; a local library connection may use `project_resolve` with a trusted host directory.
2. **Read the relevant guidance.** `show-document` coordinates a complete page; template stage guides cover intent, evidence, understanding, design, authoring and review. Query component guides and exact parameter references before preparing data.
3. **Save deliberately.** Read the complete Page and keep stable node IDs. Pass its current hash and revision to `page_apply` or `page_save`. Inspect the receipt. A conflict requires comparison and an intentional merge.
4. **Present the saved Page.** `page_present` returns full HTML/source plus an inline preview. A Codex visualization must reference the actual returned `delivery.inline` path. Compatible hosts may display the MCP Apps reader directly.

Exports are snapshots; later Page edits do not update earlier files. When a preview is too large, present meaningful selected blocks and retain the full Page delivery. Use `render_document` for explicitly standalone work.

## Diagnostics

Use Settings' actual runtime launch configuration, or the selected library's `agent-runtime.json`. CLI covers registration, startup, diagnostics, scripts and administration; agent document operations follow MCP. The [CLI reference](agent-usage.md) provides commands. Keep local plugin, application runtime and hosted MCP versions distinct when reporting an issue.

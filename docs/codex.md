# Use ShowAI in Claude Code and Codex

**Language:** English | [简体中文](i18n/codex.zh-CN.md) · [Documentation](README.md)

With ShowAI connected, Claude Code and Codex can answer with an interface instead of a block of text, save it as a page in your ShowAI project, and continue from your edits later. The plugin gives the agent ShowAI's tools and eight Skills; the ShowAI app keeps the pages and provides the runtime the plugin talks to. Install the app first — the plugin comes with it.

## Install the plugin from the app

You need the ShowAI desktop app ([quick start](quick-start.md#1-install-showai)) and Claude Code or Codex, installed and signed in.

1. Open the plugin panel in ShowAI: the welcome screen on first launch, or **Settings → Plugins** at any time.
2. Click **Install plugin** next to Claude Code or Codex and wait for **Installed and enabled**.
3. Restart the Claude Code session, or refresh plugins or restart Codex, then start a new conversation.

ShowAI installs through the agent's own plugin commands, so the agent's command-line tool must be available. On macOS, ShowAI also checks the standard Codex app locations for its bundled CLI. The app supplies the plugin files and an executable runtime, so this path needs neither the ShowAI source nor a separate Node.js installation. After installing, ShowAI verifies the installed files and the enabled state.

The plugin connects to the app's current content library. Click **Update and enable** after switching libraries or moving the app. If ShowAI is already enabled from another source, disable that plugin in the agent first, then click **Check again**.

## Check the connection

Installing the plugin, reloading the agent and a conversation picking up the new tools are separate steps; a conversation that was already open keeps its old tool list. In a new conversation, ask for an interface:

> Use ShowAI to build a mortgage calculator: price, down payment, rate and term are adjustable; show the monthly payment and total interest.

The agent should use the ShowAI tools, save the page and present it. If it answers in plain text, see [If the agent can't find ShowAI](quick-start.md#if-the-agent-cant-find-showai).

## Choose a library and project

The app-installed plugin uses the app's library. Agents launched with their own configuration can set these before the MCP process starts:

| Setting                   | Purpose                                              |
| ------------------------- | ---------------------------------------------------- |
| `SHOWAI_HOME`             | Library; defaults to `~/.showai`                     |
| `SHOWAI_PROJECT_ID`       | Optional project binding                             |
| `SHOWAI_TEMPLATES`        | Optional startup templates; requires a bound project |
| `SHOWAI_PRESENTATION_DIR` | Output directory accessible to the host              |

The library does not change while the connection runs. The local launcher probes only its selected library's registered runtime and reports incompatible versions or connection failures instead of switching libraries. For HTTP MCP, use the authorized endpoint and returned project identities. See [Agent integration](agent-integration.md).

## How the agent works with pages

Agents connected to ShowAI follow the same steps; knowing them helps when you review what the agent did.

1. **Find the content.** `projects_list` or a bound `project_context`, then `pages_list`, `library_search` and `page_read`. Read-only lookup does not create projects. New work goes into the project you name; otherwise a local connection can use `project_resolve` with the agent's working directory.
2. **Read the relevant guidance.** `show-document` coordinates a complete page through four stages: intent, material, presentation logic and design. The agent reads component guides and exact parameter references before preparing data.
3. **Save deliberately.** The agent reads the complete page, keeps stable node IDs and saves with the page's current hash and revision through `page_apply` or `page_save`. A conflict requires comparing both versions and merging on purpose.
4. **Present the saved page.** `page_present` returns full HTML/source plus an inline preview. Agents that support MCP Apps display the reader directly; Codex visualizations reference the returned `delivery.inline` path; elsewhere the agent hands you the HTML file.

Exports are snapshots: later edits to the page do not update earlier files. When a preview is too large, the agent presents selected blocks and keeps the full page delivery. `render_document` is only for explicitly standalone work that should not be saved to a project.

Agents that build on ShowAI should call `guide()`, then `showai_capabilities` and `project_context`, to establish the actual connection.

## Install from a source checkout

Use this path when developing ShowAI or running it from source. It needs **Node.js 22.12+** and a runtime supporting `showai-mcp-v1`. Start the built app once, or run `npm run runtime:register`, so the target library records `agent-runtime.json`.

Codex (requires the Codex CLI on your `PATH`):

```sh
npm run plugin:install -- --json
```

After pulling an update:

```sh
npm run plugin:update -- --json
```

The installer uses official Codex plugin commands and checks installed bytes, version and enabled state.

Claude Code, from the repository root:

```sh
claude plugin marketplace add ./
claude plugin install showai@renaissance-mind
```

See the [plugin documentation](../plugins/showai/README.md) for the Skills and DeepSeek Harness.

## Diagnostics

Use the runtime launch configuration shown in Settings, or the selected library's `agent-runtime.json`. The CLI covers registration, startup, diagnostics, scripts and administration; agent document operations go through MCP. The [CLI reference](agent-usage.md) lists commands. When reporting an issue, give the plugin, app and hosted MCP versions separately.

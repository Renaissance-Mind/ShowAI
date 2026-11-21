# ShowAI Agent plugin

**Language:** English | [简体中文](README.zh-CN.md) · [Documentation](https://github.com/Renaissance-Mind/ShowAI/blob/main/docs/README.md)

ShowAI lets your agent answer with interfaces — interactive, archived, and evolving as you use them. It has two parts: this plugin gives the agent ShowAI's tools (a stdio MCP launcher) and six Skills, and the ShowAI app keeps the pages and provides the runtime the plugin talks to. Compatibility is determined by the runtime's reported capabilities.

## Install

**Recommended: install from the ShowAI app.** Download the app from [GitHub Releases](https://github.com/Renaissance-Mind/ShowAI/releases/latest), open it, and use the plugin panel on the welcome screen or under **Settings → External Agent plugins** to install the plugin for Claude Code, Codex or Antigravity. Install the agent first and make its command-line tool available. The app supplies the plugin and runtime; no source checkout or separate Node.js is needed. Restart the Claude Code or Antigravity session, or refresh plugins or restart Codex, then start a new conversation. The connection uses the app's current library; click **Update and enable** after switching libraries or moving the app. If the app reports a conflicting plugin source, disable the listed plugin in the host before installing the app version. See [Use ShowAI in Claude Code and Codex](https://github.com/Renaissance-Mind/ShowAI/blob/main/docs/codex.md).

### From a source checkout

For source installation, use Node.js 22.12+ and Codex CLI on PATH. Build/start ShowAI, or register an installed standalone runtime, so the selected library has an agent-runtime.json. From this repository:

```sh
npm run plugin:install -- --json
# After pulling an update:
npm run plugin:update -- --json
```

The installer uses official Codex plugin commands and verifies enabled state, version and file fingerprints. For this source install, the receipt is `artifacts/codex-plugin-install.json`. Installation, host capability refresh and a conversation loading current tools/Skills are separate steps. Use the host's supported refresh procedure and confirm the current tools in a new conversation.

For everyday use, install the Claude Code plugin from the App; it connects the stable runtime. For development, start an instance (`npm run dev:open -- --port <port> --home <library>`), then in that checkout (the main directory or a worktree) run:

```sh
npm run plugin:claude -- --port <port> --json
```

Claude Code enables `showai-dev` in the main checkout or `showai-dev-<worktree name>` in a linked worktree. The name comes from Git’s worktree directory. The development plugin uses the selected instance’s runtime and library. If `showai@showai-desktop` is enabled globally, both plugins are available in that checkout. Choose the development plugin by name when testing.

The installer writes `artifacts/claude-plugin-install.json` in the checkout. Run `npm run plugin:claude -- --remove` before deleting the worktree. Use `npm run plugin:claude -- --prune` to clean up plugins for worktrees already removed.

For Antigravity (`agy` on PATH), install from the registered runtime or bind to a running development instance:

```sh
npm run plugin:antigravity -- --json
# Or bind to a running development instance:
npm run plugin:antigravity -- --port <port> --json
```

`--remove` uninstalls the plugin from Antigravity. The receipt is artifacts/antigravity-plugin-install.json.

### DeepSeek Harness

DeepSeek Harness installs plugins itself, so ShowAI prepares one complete bundle ([dsh-showai](https://github.com/Renaissance-Mind/ShowAI/blob/main/plugins/showai-deepseek/README.md)): the MCP tools bound to this runtime and library, these Skills, inline previews, a session sidebar editor and a global workbench. In the App, open **Settings → External Agent plugins → DeepSeek Harness → Prepare plugin**. From source, with a registered runtime:

```sh
npm run plugin:dsh
```

Then, once, in DeepSeek Harness: **Plugins → Add plugin**, paste the bundle path shown, choose **Enable now** and restart Harness. After updating ShowAI (App or source checkout), switching libraries, or changing the registered runtime, prepare again: this restages the same directory, and a Harness restart loads it without adding the plugin again. The installer lists earlier hand-made setups to remove first; `$DSH_HOME` is `~/.dsh` unless set:

- an older `@showai/dsh-showai-preview` bundle: Harness **Plugins** → that bundle → **Uninstall**;
- a hand-written `mcp-showai` entry in `$DSH_HOME/profiles/desktop/cordis.patch.yml`: delete that whole entry;
- ShowAI Skill folders copied into `$DSH_HOME/skills`: delete them, otherwise they shadow the bundled Skills.

### Cursor, Qoder, and WorkBuddy

Start ShowAI to register the library, then run the applicable command from the source checkout. The desktop host needs `node` available to launch the bundled MCP entry. Add `--runtime-config /absolute/path/to/agent-runtime.json` to select another registered library.

| Host      | Generate the package                                                            | Install                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cursor    | `npm run package:plugin -- --host cursor --mcp local --out showai-cursor`       | Copy the generated directory into `~/.cursor/plugins/local/`, reload the Cursor window, then use the plugin in a new local chat.                                                |
| Qoder     | `npm run package:plugin -- --host qoder --mcp local --out showai-qoder.zip`     | In Qoder desktop, open **Extensions → Plugins → Add plugin → Import plugin** and select the ZIP.                                                                                |
| WorkBuddy | `npm run package:plugin -- --host workbuddy --mcp local --out showai-workbuddy` | Add the generated directory as a WorkBuddy local plugin marketplace. You can also copy the local MCP configuration from ShowAI to **Connectors → Custom connectors → Add MCP**. |

For the WorkBuddy marketplace on macOS, use the CodeBuddy CLI shipped with WorkBuddy. Run these commands from the checkout after generating `showai-workbuddy`.

```sh
workbuddy_cli=/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs
CODEBUDDY_CONFIG_DIR="$HOME/.workbuddy" node "$workbuddy_cli" plugin marketplace add "$PWD/showai-workbuddy"
CODEBUDDY_CONFIG_DIR="$HOME/.workbuddy" node "$workbuddy_cli" plugin install showai-workbuddy@showai-workbuddy-local
```

Start a new local task and check `projects_list` to confirm the active library. For an interactive reading preview, use MCP Apps in chat. Qoder can also open the exported HTML in its built-in browser beside the chat. Cursor can open an exported file in its Browser pane. Open saved pages in ShowAI for direct editing and use the chat agent to revise the same Page through MCP.

## Host packages and shared source

Host packages use `plugins/showai-<host>/`. Kimi Work is packaged in `plugins/showai-kimi/` and the DeepSeek Harness bundle source lives in `plugins/showai-deepseek/`. Packaging also generates the original install paths `plugins-kimi/showai/` and `plugins/dsh-showai/` with the same plugin identities.

Edit workflows in `plugins/showai/skills` and host delivery contracts in `plugins/showai/host-adapters`, then run `npm run package:plugin`. The source bundle uses the native MCP Apps guide. Packaging copies the selected adapter's delivery steps into show-visual and show-document and includes the full guide at `use-showai/references/host-adapter.md`.

| Target           | Distribution                          | Delivery adaptation                                        |
| ---------------- | ------------------------------------- | ---------------------------------------------------------- |
| Codex            | `plugins/showai-codex`                | Native MCP Apps views with a file-based fallback           |
| Claude Code      | `plugins/showai-claude`               | Host HTML display tool                                     |
| Antigravity      | `plugins/showai-antigravity`          | Native MCP Apps views, page cards, and side-pane workbench |
| DeepSeek Harness | Prepared bundle directory             | Inline preview, editable session sidebar, global workbench |
| Kimi Work        | `plugins/showai-kimi`                 | Offline Widget workspace and display action                |
| Universal        | Six Skills; configure MCP in the host | MCP Apps view when supported, otherwise results and links  |

The marketplace identity stays `showai@renaissance-mind`. The generated Codex and Claude directories are committed so Git-backed marketplace installation also works in a fresh checkout. Regenerate them when changing shared source; do not edit generated Skills or launchers. `host-profile.json` records the profile, declared display and shared-file fingerprints. App installation binds the same adapters from bundled source resources. Each host must reload its installed plugin and reconnect separately; updating source does not replace an already running MCP process.

## Skills and task routing

| Skill                                                    | Purpose                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| [use-showai](skills/use-showai/SKILL.md)                 | Entry point: routing, connection, finding, reading and management    |
| [show-visual](skills/show-visual/SKILL.md)               | Show 1–5 components in the conversation, unsaved                     |
| [show-document](skills/show-document/SKILL.md)           | Create or revise works: full workflow, saving, presenting and export |
| [create-component](skills/create-component/SKILL.md)     | Reusable React expression capabilities                               |
| [create-template](skills/create-template/SKILL.md)       | Reusable template folders and methods                                |
| [collaborate-canvas](skills/collaborate-canvas/SKILL.md) | Co-editing on canvases, multi-device pairing                         |

For a chat visual, use show-visual and call `show_component({html})` with the HTML you authored. Pass an ordered array of up to five fragments for separate visuals. The runtime renders the fragments directly. Read the catalog only when the user explicitly requests existing ShowAI components. A known ID goes straight to its guide. Use `showai_capabilities({view:"presentation"})` when the host display is unknown. For project work, use use-showai.

## Runtime and library

The launcher resolves only the selected library's registered runtime and requires showai-mcp-v1 plus the relevant workflow capabilities. It reports incompatibility instead of switching libraries. Configure these in the host before startup:

| Setting                 | Purpose                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| SHOWAI_HOME             | Library root; default ~/.showai                                                                                           |
| SHOWAI_PROJECT_ID       | Optional project binding                                                                                                  |
| SHOWAI_TEMPLATES        | Startup templates, requiring SHOWAI_PROJECT_ID                                                                            |
| SHOWAI_PRESENTATION_DIR | Presentation directory accessible to the host                                                                             |
| SHOWAI_HOST_DISPLAY     | How show_component reaches this host's conversation: mcp-app, codex-visualize, fragment-file, model-html, image or native |

See [runtime setup](skills/use-showai/references/runtime.md). Updating the plugin does not upgrade the application or an already running MCP server. The embedded ShowAI Agent receives project-bound MCP from AgentHost and omits the external library launcher from its private package.

## Presentation

page_present returns complete offline HTML/source plus a conversation preview. The preview uses a local reader when it fits; a published reader can supply an online fallback. delivery.compact and delivery.online use the pinned published reader. SHOWAI_READER_CDN=off keeps reader delivery offline.

Follow the distribution’s bound host adapter for display. The shared workflows do not select another host’s presentation syntax. Runtime-owned paths and HTTP preview URLs are snapshots, while the saved project remains editable. See [conversation display](skills/use-showai/references/host-display.md).

## Universal plugin and manual MCP setup

The five host-specific packages install six Skills and the local MCP launch configuration together. Run the Agent and ShowAI on the same computer and use the host's installer. DeepSeek Harness enables the bundle prepared by ShowAI; Kimi Work installs its registered local plugin.

For another client, use **Settings → External Agent plugins** in ShowAI or generate the universal directory from source:

```sh
npm run package:plugin -- --out NEW_DIRECTORY
```

The universal package contains six Skills and an offline [connection guide](skills/use-showai/references/connect-mcp.md). For a known connection, pass `--mcp local` to use a registered local ShowAI runtime or `--mcp <MCP_URL>` for a remote server. Set `--runtime-config <absolute path>` to select a local runtime or `--mcp-auth oauth` to declare remote OAuth. The existing `--mcp-url` argument is a setup hint, and `--chatgpt-app` references a registered ChatGPT connection. When a task needs MCP and the tools are unavailable, the guide helps the user configure the connection for their host.

ChatGPT web uses a public HTTPS endpoint and OAuth. A Grok Bot connector on the same tailnet can use Tailscale Serve and device approval, or choose public HTTPS. Other clients can use a local stdio command or a reachable HTTP endpoint. Check the connection in the client with a read-only call. See [Agent setup](https://showai.renaissancemind.ai/doc/agent-hosts).

Collaborative canvas work, optional spatial references, and iPad/Mac pairing are described in [collaborate-canvas](skills/collaborate-canvas/SKILL.md).

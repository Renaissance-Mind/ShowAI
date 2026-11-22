# ShowAI Agent plugin

**Language:** English | [简体中文](README.zh-CN.md) · [Documentation](https://github.com/Renaissance-Mind/ShowAI/blob/main/docs/README.md)

ShowAI provides six Skills for creating, editing and presenting interactive pages. A local host package starts the runtime registered for the selected ShowAI library. A universal package can use a connection already configured in the host. The runtime reports the tools and presentation modes available to that connection.

## Install

**Recommended: install from the ShowAI app.** Download the app from [GitHub Releases](https://github.com/Renaissance-Mind/ShowAI/releases/latest), open it, and use the plugin panel on the welcome screen or under **Settings → Agent plugins** to install the plugin for Claude Code, Codex or Antigravity. Install the agent first and make its command-line tool available. The app supplies the plugin and runtime; no source checkout or separate Node.js is needed. Restart the Claude Code or Antigravity session, or refresh plugins or restart Codex, then start a new conversation. The connection uses the app's current library; click **Update and enable** after switching libraries or moving the app. If the app reports a conflicting plugin source, disable the listed plugin in the host before installing the app version. See [Use ShowAI in Claude Code and Codex](https://github.com/Renaissance-Mind/ShowAI/blob/main/docs/codex.md).

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

Open DeepSeek Harness once to initialize its desktop profile, then quit the application completely. In ShowAI choose **Settings → Agent plugins → DeepSeek Harness → Install plugin**. ShowAI uses the Harness package manager to install and enable the local [bundle](https://github.com/Renaissance-Mind/ShowAI/blob/main/plugins/showai-deepseek/README.md) and verifies its link. Open Harness to use the six Skills, local MCP tools, inline previews, session sidebar and global workbench.

After switching libraries or updating ShowAI, choose **Update and enable** and reopen Harness. For source development, `npm run plugin:dsh` prepares the bundle. With Harness closed, run `dsh plugin --profile desktop add "link:/absolute/path/to/the/bundle"` using the printed directory. Harness also accepts that directory through **Plugins → Add plugin → Enable now**.

The settings page identifies earlier registrations that may need cleanup. The default Harness home is `~/.dsh`:

- an older `@showai/dsh-showai-preview` bundle: Harness **Plugins** → that bundle → **Uninstall**;
- a hand-written `mcp-showai` entry in `$DSH_HOME/profiles/desktop/cordis.patch.yml`: delete that whole entry;
- ShowAI Skill folders copied into `$DSH_HOME/skills`: delete them, otherwise they shadow the bundled Skills.

### Cursor, Qoder, and WorkBuddy

Use **Install plugin** in ShowAI **Settings → Agent plugins** for a detected Cursor or WorkBuddy installation. Reload the Cursor window or start a new WorkBuddy task to load the plugin. For Qoder, choose **Prepare package** in ShowAI, then import the ZIP and review access in Qoder.

For manual installation, start ShowAI to register the library and run the matching command from the source checkout. Add `--runtime-config /absolute/path/to/agent-runtime.json` to select another registered library. A source export without a runtime binding uses Node from the host.

| Host      | Generate the package                                                            | Install                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cursor Agents | `npm run package:plugin -- --host cursor --mcp local --out showai-cursor`       | Copy the generated directory into `~/.cursor/plugins/local/`, reload the window, and start a local chat. |
| Cursor IDE | `npm run package:cursor -- --out showai-workbench.vsix` | Choose **Extensions → Install from VSIX**. The extension includes the Cursor Agent plugin. |
| Qoder     | `npm run package:plugin -- --host qoder --mcp local --out showai-qoder.zip`     | In Qoder desktop, open **Extensions → Plugins → Add plugin → Import plugin** and select the ZIP.                                                                                |
| WorkBuddy | `npm run package:plugin -- --host workbuddy --mcp local --out showai-workbuddy` | Add the generated directory as a WorkBuddy local plugin marketplace. You can also copy the local MCP configuration from ShowAI to **Connectors → Custom connectors → Add MCP**. |

For the WorkBuddy marketplace on macOS, use the CodeBuddy CLI shipped with WorkBuddy. Run these commands from the checkout after generating `showai-workbuddy`.

```sh
workbuddy_cli=/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs
CODEBUDDY_CONFIG_DIR="$HOME/.workbuddy" node "$workbuddy_cli" plugin marketplace add "$PWD/showai-workbuddy"
CODEBUDDY_CONFIG_DIR="$HOME/.workbuddy" node "$workbuddy_cli" plugin install showai-workbuddy@showai-workbuddy-local
```

In a new local task, call `project_context` to verify the library and `projects_list` to check project access. Each full plugin includes the six Skills and the host's delivery instructions. Adding an MCP connection separately loads the tools available over that connection.

| Host | Conversation | Saved pages and workspace |
| --- | --- | --- |
| Cursor Agents | Interactive MCP Apps and original-Page cards | Click the card to get the live editor link for Cursor Browser. |
| Cursor IDE | Interactive MCP Apps and original-Page cards from the bundled Agent plugin | Run **ShowAI: Open Workbench** or open a `.showai-ref` to edit the original Page in an IDE tab. |
| Qoder | Interactive MCP Apps and original-Page cards | Click the card to navigate an already open side editor in the current task. Ask the agent to open the Page on the right to start a new tab. Use **More → ShowAI** for the global workbench. |
| WorkBuddy | Interactive MCP Apps and original-Page cards | Open the live editor link in WorkBuddy's browser when available. |

Qoder's workbench entry points require the local package and a registered ShowAI runtime that includes Qoder workbench support. An older runtime can still provide basic MCP tools but will not expose those entry points; build and register the current source runtime or update the installed runtime before using them. Remote MCP connections use the display capabilities provided by that connection. WorkBuddy uses its native plugin manifest and MCP configuration; verify the tools in a new task as well as in the plugin manager.

### Kimi Code and TRAE

In ShowAI **Settings → Agent plugins**, prepare the package bound to your library. In **Kimi Code**, choose **Install custom plugin** on the **Plugins** settings page and enter the folder path. You can also merge the copied MCP configuration into `~/.kimi-code/mcp.json`. Kimi Code Desktop can open HTML in its file preview and a live ShowAI editor in its right-side browser. The CLI gives you the file and editor link. [Kimi Code plugins](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html)

For a detected **TRAE IDE**, choose **Install plugin** in ShowAI. TRAE CN opens its own MCP import confirmation after the extension is installed. You can also copy the configuration into TRAE MCP settings. Use **ShowAI: Open Workbench** or open a `.showai-ref` file. To build a manual VSIX, run `npm run package:cursor -- --host trae --out showai-trae.vsix`. [TRAE extensions](https://docs.trae.cn/ide_manage-extensions) · [TRAE MCP install links](https://docs.trae.cn/ide_mcp-server-install-links)

### Gemini CLI and OpenCode

Choose **Configure MCP** for a detected Gemini CLI in ShowAI **Settings → Agent plugins**, then start a new CLI session. For a manual setup, use **Copy MCP config** and merge the configuration into `~/.gemini/settings.json` for Gemini CLI or `opencode.json` for OpenCode. This configures the ShowAI tools through MCP. [Gemini CLI MCP docs](https://geminicli.com/docs/tools/mcp-server/)

## Host packages and shared source

Each dedicated package includes its own entry Skill, connection guide, delivery steps and README. The universal download includes the cross-host installation and connection guides. The TRAE IDE extension provides the workbench and uses a separate MCP connection.

Host packages use `plugins/showai-<host>/`. Kimi Work is packaged in `plugins/showai-kimi/` and the DeepSeek Harness bundle source lives in `plugins/showai-deepseek/`. Packaging also generates the original install paths `plugins-kimi/showai/` and `plugins/dsh-showai/` with the same plugin identities.

Edit workflows in `plugins/showai/skills` and host delivery contracts in `plugins/showai/host-adapters`, then run `npm run package:plugin`. The source bundle uses the native MCP Apps guide. Packaging copies the selected adapter's delivery steps into show-visual and show-document and includes the full guide at `use-showai/references/host-adapter.md`.

| Target           | Distribution                          | Delivery adaptation                                        |
| ---------------- | ------------------------------------- | ---------------------------------------------------------- |
| Codex            | `plugins/showai-codex`                | Native MCP Apps views with a file-based fallback           |
| Claude Code      | `plugins/showai-claude`               | Host HTML display tool                                     |
| Antigravity      | `plugins/showai-antigravity`          | Native MCP Apps views, Page cards, side editor, and global workbench |
| DeepSeek Harness | Local bundle installed by the Harness CLI             | Inline preview, editable session sidebar, global workbench |
| Kimi Work        | `plugins/showai-kimi`                 | Offline Widget workspace and display action                |
| Qoder            | Generated local plugin                | Chat MCP Apps, global and task workbenches                 |
| Cursor           | Generated local plugin                | Chat MCP Apps; saved pages edited through MCP or ShowAI    |
| WorkBuddy        | Generated local marketplace           | Chat MCP Apps; saved pages edited through MCP or ShowAI    |
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

Local host packages connect an agent to ShowAI on the same computer. Choose your host in **Settings → Agent plugins** and follow its directory, extension or marketplace install flow. ShowAI installs the DeepSeek bundle with the Harness CLI. Kimi Work registers the prepared local plugin in its own plugin manager.

Download the [universal plugin ZIP](https://raw.githubusercontent.com/Renaissance-Mind/ShowAI/main/downloads/showai-universal.zip) for a client with its own MCP connection, or generate a package from source:

```sh
npm run package:plugin -- --out NEW_DIRECTORY
```

The universal package contains six Skills and an offline [connection guide](skills/use-showai/references/connect-mcp.md). For a known connection, pass `--mcp local` to use a registered local ShowAI runtime or `--mcp <MCP_URL>` for a remote server. Set `--runtime-config <absolute path>` to select a local runtime or `--mcp-auth oauth` to declare remote OAuth. The existing `--mcp-url` argument is a setup hint, and `--chatgpt-app` references a registered ChatGPT connection. When a task needs MCP and the tools are unavailable, the guide helps the user configure the connection for their host.

ChatGPT web uses a public HTTPS endpoint and OAuth. A Grok Bot connector on the same tailnet can use Tailscale Serve and device approval, or choose public HTTPS. Other clients can use a local stdio command or a reachable HTTP endpoint. Check the connection in the client with a read-only call. See [connection guide](skills/use-showai/references/connect-mcp.md).

Collaborative canvas work, optional spatial references, and iPad/Mac pairing are described in [collaborate-canvas](skills/collaborate-canvas/SKILL.md).

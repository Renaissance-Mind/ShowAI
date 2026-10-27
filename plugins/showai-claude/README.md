# ShowAI Agent plugin

**Language:** English | [简体中文](README.zh-CN.md) · [Documentation](https://github.com/Renaissance-Mind/ShowAI/blob/main/docs/README.md)

ShowAI lets your agent answer with interfaces — interactive, archived, and evolving as you use them. It has two parts: this plugin gives the agent ShowAI's tools (a stdio MCP launcher) and nine Skills, and the ShowAI app keeps the pages and provides the runtime the plugin talks to. Compatibility is determined by the runtime's reported capabilities.

## Install

**Recommended: install from the ShowAI app.** Download the app from [GitHub Releases](https://github.com/Renaissance-Mind/ShowAI/releases/latest), open it, and use the plugin panel on the welcome screen or under **Settings → Plugins** to install the plugin for Claude Code or Codex. Install the agent first and make its command-line tool available. The app supplies the plugin and runtime; no source checkout or separate Node.js is needed. Restart the Claude Code session, or refresh plugins or restart Codex, then start a new conversation. The connection uses the app's current library; click **Update and enable** after switching libraries or moving the app. Disable a ShowAI plugin enabled from another source before installing the app version. See [Use ShowAI in Claude Code and Codex](https://github.com/Renaissance-Mind/ShowAI/blob/main/docs/codex.md).

### From a source checkout

For source installation, use Node.js 22.12+ and Codex CLI on PATH. Build/start ShowAI, or register an installed standalone runtime, so the selected library has an agent-runtime.json. From this repository:

```sh
npm run plugin:install -- --json
# After pulling an update:
npm run plugin:update -- --json
```

The installer uses official Codex plugin commands and verifies enabled state, version and file fingerprints. It records artifacts/codex-plugin-install.json. Installation, host capability refresh and a conversation loading current tools/Skills are separate steps. Use the host's supported refresh procedure and confirm the current tools in a new conversation.

For everyday use, install the Claude Code plugin from the App; it connects the stable runtime. For development, start an instance (`npm run dev:open -- --port <port> --home <library>`), then in that checkout (the main directory or a worktree) run:

```sh
npm run plugin:claude -- --port <port> --json
```

The main directory gets `showai-dev` and a worktree gets `showai-dev-<directory>`, pinned to that instance's runtime and library. The plugin is enabled only in this checkout's `.claude/settings.json`, which also turns off the App-installed `showai` here, so a session sees one ShowAI plugin. `--remove` uninstalls this checkout's plugin; `--prune` cleans up after deleted worktrees. The receipt is artifacts/claude-plugin-install.json.

### DeepSeek Harness

DeepSeek Harness installs plugins itself, so ShowAI prepares one complete bundle ([dsh-showai](https://github.com/Renaissance-Mind/ShowAI/blob/main/plugins/dsh-showai/README.md)): the MCP tools bound to this runtime and library, these Skills, and inline page previews. In the App, open **Settings → Plugins → DeepSeek Harness → Prepare plugin**. From source, with a registered runtime:

```sh
npm run plugin:dsh
```

Then, once, in DeepSeek Harness: **Plugins → Add plugin**, paste the bundle path shown, choose **Enable now** and restart Harness. After updating ShowAI (App or source checkout), switching libraries, or changing the registered runtime, prepare again: this restages the same directory, and a Harness restart loads it without adding the plugin again. The installer lists earlier hand-made setups to remove first; `$DSH_HOME` is `~/.dsh` unless set:

- an older `@showai/dsh-showai-preview` bundle: Harness **Plugins** → that bundle → **Uninstall**;
- a hand-written `mcp-showai` entry in `$DSH_HOME/profiles/desktop/cordis.patch.yml`: delete that whole entry;
- ShowAI Skill folders copied into `$DSH_HOME/skills`: delete them, otherwise they shadow the bundled Skills.

## Host packages and shared source

Edit workflows in `plugins/showai/skills` and host delivery contracts in `plugins/showai/host-adapters`, then run `npm run package:plugin`. The source bundle uses the native MCP Apps guide. Packaging copies every shared workflow unchanged and binds only `use-showai/references/host-adapter.md` for the selected host.

| Target | Distribution | Delivery adaptation |
| --- | --- | --- |
| Codex | `plugins/showai-codex` | Local visualization reference |
| Claude Code | `plugins/showai-claude` | Host HTML display tool |
| DeepSeek Harness | Prepared bundle directory | Automatic tool-result preview |
| Kimi Work | `plugins-kimi/showai` | Offline Widget workspace and display action |
| Remote MCP Apps | Remote package or built-in HTTP guides | Attached native view |

The marketplace identity stays `showai@renaissance-mind`. The generated Codex and Claude directories are committed so Git-backed marketplace installation also works in a fresh checkout. Regenerate them when changing shared source; do not edit generated Skills or launchers. `host-profile.json` records the profile, declared display and shared-file fingerprints. App installation binds the same adapters from bundled source resources. Each host must reload its installed plugin and reconnect separately; updating source does not replace an already running MCP process.

## Skills and task routing

| Skill                                                      | Purpose                                             |
| ---------------------------------------------------------- | --------------------------------------------------- |
| [use-showai](skills/use-showai/SKILL.md)                   | Connection identity, discovery, reading and routing |
| [show-visual](skills/show-visual/SKILL.md)                 | Show 1–5 components in the conversation, unsaved    |
| [plan-presentation](skills/plan-presentation/SKILL.md)     | Reader intent, material and presentation logic      |
| [design-presentation](skills/design-presentation/SKILL.md) | Scene-by-scene design draft, layout and interaction |
| [show-document](skills/show-document/SKILL.md)             | Create, continue, save, present and export Pages    |
| [review-presentation](skills/review-presentation/SKILL.md) | Assess understanding, revise and verify             |
| [create-component](skills/create-component/SKILL.md)       | Reusable React expression capabilities              |
| [create-template](skills/create-template/SKILL.md)         | Reusable template folders and methods               |
| [collaborate-canvas](skills/collaborate-canvas/SKILL.md)   | Co-editing on canvases, multi-device pairing        |

Agent document operations use MCP. Begin with guide() and capability/project discovery. Formal work is saved in the selected project before page_present. render_document serves explicitly standalone delivery. Detailed methods remain in the canonical Skills; this README is the installation entrypoint.

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

## ChatGPT web and remote packages

For regular ChatGPT web use, add the hosted MCP connection and read workflows through guide; a local Skill installation or ZIP is unnecessary. Follow [ChatGPT setup](https://github.com/Renaissance-Mind/ShowAI/blob/main/docs/chatgpt.md).

Operators can generate an HTTP/OAuth package from the same Skills:

```sh
npm run package:plugin -- --mcp-url HTTPS_MCP_URL --out NEW_DIRECTORY
```

The output is showai-cloud without the local launcher. It uses OAuth dynamic client registration. Add --chatgpt-app asdk_app_ID when using an existing registered ChatGPT connection. To install beside the local plugin:

```sh
node scripts/install-codex-plugin.mjs --remote-url HTTPS_MCP_URL --marketplace-root DIRECTORY
```

The installer uses a separate marketplace and verifies its installed files. No credentials enter the package. Deployment and public submission remain separate release operations. See [Agent integration](https://github.com/Renaissance-Mind/ShowAI/blob/main/docs/agent-integration.md).

Collaborative canvas work, optional spatial references, and iPad/Mac pairing are described in [collaborate-canvas](skills/collaborate-canvas/SKILL.md).

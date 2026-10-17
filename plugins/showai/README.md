# ShowAI Agent plugin

**Language:** English | [简体中文](README.zh-CN.md) · [Documentation](../../docs/README.md)

The local **0.18.0** plugin supplies eight Skills and a stdio MCP launcher for reading, creating, revising and presenting ShowAI content. The application/runtime is installed separately. The repository's application source version is **0.9.0**; runtime capabilities determine compatibility.

## Install locally

Desktop App users can open **Settings → Plugins** to install the plugin for Codex or Claude Code. Install the host first and make its plugin-management CLI available. The App supplies the plugin and runtime; no source checkout or separate Node.js is needed. Refresh/restart the host after installation. The connection uses the selected library; update it again after switching libraries or moving the App. Disable an enabled ShowAI plugin from another source before installing the App version.

For source installation, use Node.js 22.12+ and Codex CLI on PATH. Build/start ShowAI, or register an installed standalone runtime, so the selected library has an agent-runtime.json. From this repository:

```sh
npm run plugin:install -- --json
# After pulling an update:
npm run plugin:update -- --json
```

The installer uses official Codex plugin commands and verifies enabled state, version and file fingerprints. It records artifacts/codex-plugin-install.json. Installation, host capability refresh and a conversation loading current tools/Skills are separate steps. Use the host's supported refresh procedure and confirm the current tools in a new conversation.

For Claude Code, from the repository root:

```sh
claude plugin marketplace add ./
claude plugin install showai@renaissance-mind
```

## Skills and task routing

| Skill                                                      | Purpose                                             |
| ---------------------------------------------------------- | --------------------------------------------------- |
| [use-showai](skills/use-showai/SKILL.md)                   | Connection identity, discovery, reading and routing |
| [plan-presentation](skills/plan-presentation/SKILL.md)     | Reader goals, evidence and understanding path       |
| [design-presentation](skills/design-presentation/SKILL.md) | Visual objects, layout, states and interaction      |
| [show-document](skills/show-document/SKILL.md)             | Create, continue, save, present and export Pages    |
| [review-presentation](skills/review-presentation/SKILL.md) | Assess understanding, revise and verify             |
| [create-component](skills/create-component/SKILL.md)       | Reusable React expression capabilities              |
| [create-template](skills/create-template/SKILL.md)         | Reusable template folders and methods               |

Agent document operations use MCP. Begin with guide() and capability/project discovery. Formal work is saved in the selected project before page_present. render_document serves explicitly standalone delivery. Detailed methods remain in the canonical Skills; this README is the installation entrypoint.

## Runtime and library

The launcher resolves only the selected library's registered runtime and requires showai-mcp-v1 plus the relevant workflow capabilities. It reports incompatibility instead of switching libraries. Configure these in the host before startup:

| Setting                 | Purpose                                        |
| ----------------------- | ---------------------------------------------- |
| SHOWAI_HOME             | Library root; default ~/.showai                |
| SHOWAI_PROJECT_ID       | Optional project binding                       |
| SHOWAI_TEMPLATES        | Startup templates, requiring SHOWAI_PROJECT_ID |
| SHOWAI_PRESENTATION_DIR | Presentation directory accessible to the host  |

See [runtime setup](skills/use-showai/references/runtime.md). Updating the plugin does not upgrade the application or an already running MCP server. The embedded ShowAI Agent receives project-bound MCP from AgentHost and omits the external library launcher from its private package.

## Presentation

page_present returns complete offline HTML/source plus a conversation preview. The preview uses a local reader when it fits; a published reader can supply an online fallback. delivery.compact and delivery.online use the pinned published reader. SHOWAI_READER_CDN=off keeps reader delivery offline.

The host displays MCP Apps, uses the actual local Codex visualization path or offers the full HTML/source. Display support depends on the host. Runtime-owned paths and HTTP preview URLs are snapshots, while the saved project remains editable. See [conversation display](skills/show-document/references/conversation-display.md).

## ChatGPT web and remote packages

For regular ChatGPT web use, add the hosted MCP connection and read workflows through guide; a local Skill installation or ZIP is unnecessary. Follow [ChatGPT setup](../../docs/chatgpt.md).

Operators can generate an HTTP/OAuth package from the same Skills:

```sh
npm run package:plugin -- --mcp-url HTTPS_MCP_URL --out NEW_DIRECTORY
```

The output is showai-cloud without the local launcher. It uses OAuth dynamic client registration. Add --chatgpt-app asdk_app_ID when using an existing registered ChatGPT connection. To install beside the local plugin:

```sh
node scripts/install-codex-plugin.mjs --remote-url HTTPS_MCP_URL --marketplace-root DIRECTORY
```

The installer uses a separate marketplace and verifies its installed files. No credentials enter the package. Deployment and public submission remain separate release operations. See [Agent integration](../../docs/agent-integration.md).

Collaborative canvas work, optional spatial references, and iPad/Mac pairing are described in [collaborate-canvas](skills/collaborate-canvas/SKILL.md).

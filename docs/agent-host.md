# Built-in agent

**Language:** English | [简体中文](i18n/agent-host.zh-CN.md) · [Documentation](README.md)

Use **Ask AI** from selected text/cells, a block menu or selected Board objects. The Page toolbar opens project conversations. **Settings → Agent** configures execution location, local agents and model sources. Every execution path uses project-bound MCP and the Page's current hash/revision.

## Choose where work runs

| Location    | Setup                                                            | Requirements                                                            |
| ----------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| This device | Local agent or API-backed SDK                                    | Installed agent/login, or configured model source                       |
| Cloud       | Select server account and Cloud location                         | Available Cloud execution service, synced project and model source      |
| Paired Mac  | Enable remote execution on Mac and approve the requesting device | Same server account, permitted project, online awake Mac running ShowAI |

On iPad, choose the server account and execution location in the AI panel or Agent settings. Cloud can use your API source or a server model resource. To use a ChatGPT plan in Cloud, authorize in ShowAI on the Mac first, publish that source to your server, then select the server source on iPad. The authorization flow requires a local callback; available models and plan use depend on the actual account/consent.

On Mac, enable **Let iPad use this computer**, select the server account and allowed synchronized projects. On the same local network, choose **Pair a nearby Mac** on iPad. Compare the six-digit code on both screens and approve the request on Mac; no QR code is required. The remembered certificate and device credential reconnect automatically. Revoked or changed identities require pairing again. Mac execution uses that Mac's existing configuration and login. The outbound WSS relay remains available outside the local network.

For projects using paired-Mac saving, iPad retains a durable local replica and pending changes. It sends page changes to Mac over pinned TLS, receives change notifications over WSS, and Mac continues the existing server synchronization. Independent edits merge; overlapping edits remain pending with a visible conflict. Offline edits stay on iPad until reconnection. **Disconnect and use server sync** resumes the ordinary synchronization path while preserving pending content. Cloud tasks require the Mac to finish server synchronization before execution.

Agent execution leaves the canvas editable. Each conversation retains its own input draft and target, and tool updates replace their earlier progress entry. The composer’s **Mark reference position** captures a point or region in canvas coordinates; it is advisory prompt context. New ordinary components placed on a Board enter editable Page containers. Related components can share a Page; `attrs.frameless:true` removes its visible frame. See the [collaborative canvas Skill](../plugins/showai/skills/collaborate-canvas/SKILL.md).

Execution settings/model sources remain separate for each destination. A conversation retains its project, account and execution-device binding. Cancellation, approvals, attachments, resumption and undo follow that binding. Save and synchronize before sending; if content changes during synchronization, inspect the latest Page. Remote turns report completion after publishing the Page result and expose disconnect/sync failures.

## Local execution modes

| Mode            | Runtime                                                      | Configuration                                                |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Local agent     | Codex, Kimi, Claude Code, Gemini CLI or OpenCode             | Reuse the installed agent's authentication and settings      |
| Provide LLM API | On-demand official Codex TypeScript SDK and platform runtime | ShowAI-managed model source and isolated runtime directories |

Local Codex starts a task session; it does not take over an existing desktop conversation. Kimi/Gemini/OpenCode use ACP; tool approval requests allow once or reject in the conversation. Claude Code uses its noninteractive interface. A discovered config file does not prove a successful invocation: use the connection test and inspect its real result.

API presets include ChatGPT plan, OpenRouter, DeepSeek, OpenAI API, Moonshot and custom services. Responses sources forward Responses requests; Chat Completions sources use a task-local conversion gateway. Verify compatibility against the actual model. Local API/OAuth credentials reside in private application data and settings return status only. Provider credentials stay in the gateway; the subprocess receives a task credential over loopback. ChatGPT authorization is sent only to its official Responses service.

The SDK installer downloads official npm packages, verifies SHA-512 and extracts without install scripts. It uses its own Codex home, sessions and plugin installation. Failed updates retain the previous installation record and report the cause.

## Conversations and editing

Requests include the current Page, stable block IDs and selected text. Quick actions include polishing, shortening, expanding, translating, visualizing and explaining. Explanation-only requests answer in chat. The host saves before sending and asks the agent to read/modify only the requested objects.

Conversations retain requests, targets, execution events and results per project. Editing remains available during execution. External writes load when there are no local unsaved edits; otherwise the existing conflict flow applies. Turn results identify changed objects. Undo uses actual tool-write records and preserves previously saved human edits. Interleaved or later external changes can prevent whole-turn undo; old conversations without write records cannot be undone this way.

API/Codex/Claude Code resume their underlying session; Kimi/Gemini/OpenCode start a new session with a labeled prior-turn summary. Read-only/export readers hide AI editing entrypoints. The built-in chat currently delivers text and file links; producing inline HTML alone does not establish inline rendering support.

## State and permissions

Desktop state/credentials live in `agent-host` under Electron userData. Conversations live under `conversations/<project>/`. Workspaces default to **Documents/ShowAI/Agent Workspaces**, separated by project/conversation; development can use `SHOWAI_AGENT_WORKSPACES`. Page tools save to the original project; workspaces contain supporting files.

The API-backed subprocess has independent settings and does not inherit the user's keys, login tokens, host session IDs or general Skills/plugins. Its project MCP copy omits the external library launcher. Command execution uses the configured workspace-write sandbox. Local-agent mode retains that installed agent's own configuration and approval behavior.

Cloud execution uses a Worker, Durable Objects, per-account Containers and encrypted R2 checkpoints. Existing state keys/buckets must survive redeployment. Restored state discards dead process leases and reconciles interrupted turns. Content sync, remote execution and the ChatGPT MCP gateway are separate services; enabling sync alone does not deploy the others. Operators use `node scripts/deploy-remote-agent.mjs <private-release-directory> [committed-revision]` and retain private receipts/key backups outside the repository.

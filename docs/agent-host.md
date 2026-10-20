# Built-in agent

**Language:** English | [简体中文](i18n/agent-host.zh-CN.md) · [Documentation](README.md)

Use **Ask AI** from selected text/cells, a block menu or selected Board objects. The Page toolbar opens project conversations. **Settings → Agent** configures execution location, local agents and model sources. Every execution path uses project-bound MCP and the Page's current hash/revision.

The same selection, block, Board object and page menus offer **Copy reference** for an Agent running elsewhere, such as Claude Code or Codex in a terminal. ShowAI saves the page first, then copies a heading, a `showai://` link that opens the page and highlights the blocks, and one JSON line (`"type":"showai.reference"`) pinned to the saved hash/revision with block or Board object IDs and up to 20 text labels; the notice names the version. Agents read the IDs with ShowAI MCP and compare versions before writing, as the [use-showai Skill](../plugins/showai/skills/use-showai/SKILL.md) describes. Components that support it can **hand their current state** to the conversation: it appears as a removable chip in the Agent input, is sent only with your next message and is never saved to the Page.

## Choose where work runs

| Location    | Setup                                                            | Requirements                                                            |
| ----------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| This device | Local agent or API-backed SDK                                    | Installed agent/login, or configured model source                       |
| Cloud       | Choose Cloud; the account follows the current project            | Available Cloud execution service, synced project and model source      |
| Paired Mac  | Choose Connect Mac on iPad; approve once on Mac                   | Same local network, awake Mac running ShowAI with a model configured     |

On iPad, choose the execution location in the AI panel or Agent settings. Cloud can use your API source or a server model resource. To use a ChatGPT plan in Cloud, authorize in ShowAI on the Mac first, publish that source to your server, then select the server source on iPad. The authorization flow requires a local callback; available models and plan use depend on the actual account/consent.

For a nearby Mac, open ShowAI on both devices and join the same network. On iPad choose **Connect Mac → Use this Mac**, then compare the six-digit code and approve once on Mac. Remembered devices reconnect directly; a revoked credential or changed Mac identity starts pairing again. Nearby connections are enabled by default and can be turned off in Mac Agent settings. Local iPad projects work without a Cloud account or project permission checklist: ShowAI prepares a separate workspace on Mac for that iPad project. This grants no access to other existing Mac workspaces. Mac execution uses its existing model configuration and login.

The current project's sync account is selected automatically. iPad retains a durable local copy and pending changes. Pinned TLS transfers Page changes and WSS delivers update notifications. Existing Mac-managed synchronized projects keep Mac as the server writer; newly received iPad projects keep their existing iPad-to-server synchronization. Local projects are not uploaded to Cloud. Independent changes merge; overlapping changes remain as pending conflicts. Offline changes remain on iPad and merge after reconnection.

For execution outside the local network, expand **Connect across networks** in Mac Agent settings and configure the WSS relay's server account and allowed synchronized projects. This optional route requires the same server identity and project grant; a newly received local workspace remains available over the local network.

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

A turn is checkpointed before its execution starts. Background snapshots do not accumulate behind slow storage, and state uploads use a tenant-scoped Worker binding. Retrying an admitted request with the same ID returns its original receipt. Provider rejection details retain actionable JSON errors while redacting credentials.

Verify the running account Container after rollout as well as the Worker revision: an existing Durable Object can still be serving an earlier version. Deployment health covers runtime, browser rendering, sandbox and WSS; a real configured-model call and a synchronized page write are separate acceptance checks. Operator recovery restores the committed encrypted state and is protected by the deployment master key.

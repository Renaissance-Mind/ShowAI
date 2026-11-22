# One ShowAI workflow across Agent hosts

**Language:** English | [简体中文](i18n/agent-integration.zh-CN.md) · [Documentation](README.md)

**Agent document operations use MCP** in every host. Start a public visual with `show-visual`. Use `use-showai` for project ownership and other workflows. Local host plugins ship their stdio launcher and Skills together. The universal plugin uses MCP configured manually in the host, with stdio or a reachable HTTP endpoint.

Local library MCP uses explicit `projectId` per operation. Use `projects_list` for read-only discovery, `project_resolve` with a trusted absolute `sourceDirectory` for new formal content, or a project-bound connection. Save formal work before delivering it through the host adapter. Use `render_document` for explicitly standalone deliverables. **Connection failure** does not change the destination or persistence mode.

ShowAI 0.9 provides independent presentations and shared-project work. **Display and synchronization are separate choices**:

| Host display       | No synchronization                                                         | Shared project                                                                                    |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Inline or MCP Apps | Customize public components/templates, render, deliver HTML/inline/source. | Read/write the authorized project, confirm sync, optionally present it.                           |
| Text only          | Deliver files, or write a same-machine local project.                      | Read/write and return a synchronization receipt. People see the result in their ShowAI workbench. |

The page model, component compiler, authoring service, revision checks, export reader and sync protocol are shared. Hosts adapt how they invoke tools and show results. Supporting MCP alone does not imply HTML display support. Claude, pi, dsh and other hosts can use the documented CLI or MCP interfaces according to their actual capabilities; host-specific live acceptance is recorded separately.

## Local use

Find the actual runtime under **Settings → Plugins** (**Registered runtime** and the launch configuration) or in the selected library's `agent-runtime.json`. `showai` below abbreviates that executable and its arguments. Inspect `runtime info --json` and `guide integration --json`.

```sh
showai public list --kind component --view compact --json
showai public describe chart --view schema --json
showai public describe explainer --kind template --view source --json
showai render --input presentation.json --out /absolute/output/page.html --json
showai mcp --public
showai mcp --project PROJECT_ID
```

Public rendering does not initialize or modify a personal project. Input is `{document?, templateId?, title?, componentSources?, blockIds?}`; choose document or templateId. Components use the existing editable package contract: manifest, schema, source and optional files/assets. The renderer compiles in an isolated temporary workspace and removes that workspace afterward. Its receipt reports `savedToProject: false` and `synchronized: false`. Exported HTML, inline and source remain at the requested destination. Custom nodes use `attrs.kind="custom"` with `attrs.data={componentId,version,props}`; unregistered widget kinds fail with a corrective error. Public source output retains the original componentSources for customization. If inline exceeds the host limit, complete HTML/source are still returned; use blockIds for a smaller inline selection while retaining the full source.

Library stdio (`showai mcp`) adds `projects_list`, `project_resolve` and `project_create`. Project-bound stdio keeps the existing project tool names and also exposes public resources/rendering. `mcp --public` exposes only public resources and rendering. Local rendering results include paths in the selected library's `local/agent-previews/`, outside synchronized project content.

For local project work, keep the usual read → modify with hash/revision → save → sync workflow. Scripts can run `sync run --project PROJECT --json`; MCP Agents use `project_sync` and `project_sync_status`. No HTML display is required to complete a project operation. An explicitly scoped synchronization enrolls and processes only that project; the full background run continues following the library's default policy.

## Remote MCP

The desktop App offers local network HTTP with access keys, private Tailscale Serve, and public Cloudflare or Tailscale Funnel through **Settings → Remote connection**. HTTPS connections use OAuth with desktop approval; all modes save directly in the local library. See [device and client setup](chatgpt.md). The `mcp serve` gateway below uses a configured sync server; passing `--home` alone does not expose that library's private projects.

Run the agent gateway with the independently installed ShowAI runtime. It uses Node.js and the same compiler/reader assets as the CLI. It is separate from the content synchronization server; the sync server continues storing snapshots and objects without executing components.

```sh
showai mcp serve \
  --state /absolute/private/showai-agent-state \
  --host 127.0.0.1 --port 8789 \
  --public-url https://agent.example.com \
  --sync-server https://content.example.com
```

Use a stable HTTPS reverse proxy for the public URL. The MCP URL is `https://agent.example.com/mcp`; `/health` reports readiness without exposing private paths or credentials. `--sync-server` accepts a comma-separated list of deployment-approved ShowAI Server base URLs (including prefixes such as /cloud). With no sync server configured, public rendering remains usable. The OAuth login page lets users select one configured server and authorize either one selected project or the account’s current and future accessible projects. Each server account uses its own connection.

`--state` contains the private OAuth database and per-grant project replicas. Restrict it to the service account. Its tokens and replicas must not be published or copied into the plugin. Reverse proxies must preserve the public Host. `--widget-domain` can declare the dedicated UI origin required for public plugin submission. Local development permits a loopback HTTP public URL; published connections require HTTPS.

### Cloudflare deployment

The all-Cloudflare deployment uses `deployments/cloudflare/mcp.wrangler.jsonc`: a Worker and Durable Object route to the Node.js Container. `scripts/build-cloud-mcp.mjs` builds the gateway; the Dockerfile installs Linux dependencies and packages compiler/reader assets. No separate VPS is required.

Private state is encrypted with the independent `SHOWAI_MCP_STATE_KEY` and checkpointed in the private `showai-mcp-state` R2 bucket before a request is acknowledged. A fresh container restores and verifies that checkpoint. Preview artifacts retain their one-hour expiry across restart. A failed checkpoint prevents a success response and must be retried before the next mutation. Keep the original state key securely backed up; replacing it makes existing checkpoints unreadable. Unreferenced encrypted chunks are retained; garbage collection is not implemented in this release.

For deployment commands and acceptance gates, see [Cloudflare MCP operations](cloud-mcp-deployment.md). A local build or Worker dry-run does not establish a working Container deployment, provider login or ChatGPT acceptance.

### Public and authorized tools

For a chat visual, use show-visual and call `show_component({html})` with the HTML you authored. Pass an ordered array of up to five fragments for separate visuals. The runtime renders the fragments directly. Read the catalog only when the user explicitly requests existing ShowAI components. A known ID goes straight to its guide. Use `showai_capabilities({view:"presentation"})` when the host display is unknown.

| Client | How the visual tools become available |
| --- | --- |
| Claude Code | The MCP server marks `show_component` with `_meta["anthropic/alwaysLoad"]`. An explicit client setting can override it. [Tool loading](https://code.claude.com/docs/en/mcp#mark-a-tool-to-load-upfront-or-stay-deferred) |
| Antigravity | The plugin requests eager loading for `show_component` in `mcp_config.json`. [Eager tools](https://antigravity.google/docs/mcp#configure-eager-tools) |
| Codex | Use the registered tools directly when visible. With tool search enabled, search together for the needed names. |
| Kimi Work | Use the registered tools. In sessions that expose `select_tools`, select the needed names together. |
| DeepSeek Harness | Its MCP client registers tools at connection time. The desktop and local Web UI show inline previews, a session sidebar for editing and quoting a Page into the draft, and a global workbench in the left navigation. |
| ChatGPT MCP Apps and other HTTP clients | The server supplies the same tool schemas through `tools/list`. The client controls discovery and rendering. Clients without installed Skills can follow the tool descriptions. |

The built-in Agent requests a component index when authoring a page or when the user asks to use existing components. Conversation HTML needs only the display tool. The embedded text view can link the file returned by a local preview.

Public tools are `showai_capabilities`, `public_catalog_list`, `public_catalog_describe`, `render_document`, `show_component` and `presentation_source`. The last tool retrieves editable public render input in text chunks when a host cannot download the HTTP URL; it does not expose private project exports. The catalog includes built-in components and editable starter templates. All public rendering inputs come from the caller; anonymous operations do not read the user's content library.

Private tools retain the existing authoring names, add an explicit `projectId`, and use OAuth. `projects_list` queries current server membership on every call. Selected-project grants remain restricted to their original IDs; account grants include later projects. `project_create` requires account authorization and the separate `projects.create` scope; it creates and synchronizes the project, returns its server ID, and accepts an operationId UUID for retrying the same request. `page_present` supplies the same reader as public rendering. Local path-based import, whole-site publication and local recovery tools stay local; remote component customization uses `component_save` with source. Remote exports use service-owned temporary paths and return downloadable artifacts instead of server filesystem paths.

### Permissions and synchronization

Each private call checks its token, consented project, scopes and current server role. The gateway serializes pull → operation → push in the grant's replica. Remote history records the entry as an external MCP client; it does not inherit the gateway launcher's Codex session. The response includes `synchronization.state`, `error` when present, and `remoteHead`. If a replica write succeeds but publication fails, the result is marked unsuccessful and the replica is retained. Cross-device conflicts keep both inputs as source-labeled pages; callers must use the returned page ID. Same-device stale writes continue to require deliberate conflict handling.

### Authorization

OAuth supports discovery, dynamic client registration, authorization code with S256 PKCE, resource binding, access-token expiry, rotating refresh tokens, consent and revocation. It authenticates existing ShowAI Server accounts; it does not create users during linking. GitHub and Google login use the explicitly configured server’s existing login providers. The user completes provider login in a separate tab, which then shows a one-time completion code; the user enters that code in the MCP authorization tab and continues to explicit project/account consent. The code binds the provider login to the tab that started it, so a forwarded provider link cannot sign in another client. The provider polling credential stays server-side. Existing accounts must bind the chosen provider first; linking does not silently create or merge accounts. Account/password login remains available; the password is forwarded only to the explicitly configured server and is not stored. Upstream session credentials are held in private state to perform the consented project operations.

## MCP call logs

The source runtime records each `tools/call` as `started` and `completed` JSONL events. Project-bound and library stdio entrypoints, including the built-in Agent, use `<library>/local/mcp-logs/`. Public stdio uses the sibling directory `<library>.mcp-logs/` so it does not initialize a content library. Local HTTP uses `<library>/local/mcp-logs/`; the hosted gateway uses `<stateDirectory>/logs/mcp/`. This takes effect when the runtime is rebuilt and its MCP processes restart; installing a Skill alone does not update a running runtime.

Filter `event == "completed"` when counting calls. Records include UTC time, transport, tool/action, app/plugin versions, input/output JSON bytes, elapsed milliseconds, status (`success`, `error`, `cancelled`, `interrupted` or `transport_error`) and error code. `callId` pairs events; `instanceId` and `sequence` order calls within a writer. Stdio includes the initialized client name/version and a session ID. HTTP is stateless: it only records a session ID when the caller supplies `mcp-session-id`; authorized calls also include an authorization ID. Resource, request, operation, group, authorization and supplied session IDs are SHA-256 digests truncated to 24 hex characters. A lone `started` event can indicate an in-flight call or an ungraceful process exit. Graceful stdio closure records interrupted calls; cancellation notifications mark cancelled failures. HTTP duration includes project synchronization and, when configured, the durable-state checkpoint, but does not measure client receipt or host rendering.

Logs omit argument objects, document/source content, result bodies, headers, credentials and error messages. Metadata labels are bounded and redacted. Each writer uses a separate file, rotated at 5 MiB with three files retained, avoiding rotation races between processes. A writer checks for files untouched for 30 days at first write and at most once daily thereafter. Log files are owner-only on POSIX. A log I/O failure emits one warning on stderr per writer and leaves tool behavior intact.

Set `SHOWAI_MCP_LOG=0` before starting the runtime to disable logging, or `SHOWAI_MCP_LOG_DIRECTORY=/absolute/private/path` to choose its directory. These logs stay with the instance; collection into a shared analytics service is not automatic. Malformed JSON, host/origin/body-size rejections and non-tool methods are outside this call log.

## ChatGPT and other display hosts

For the official endpoint, account setup, consent and connection updates, see [ChatGPT web setup](chatgpt.md). Template-stage guidance and exact parameter queries are described in [template folders](template-bundles.md) and [component parameters](component-parameters.md).

In ChatGPT's plugin directory, add a custom MCP server using the `/mcp` URL and choose **OAuth or no authentication**. Anonymous tools remain available without linking; private calls request the appropriate project scopes. Test the tools in the host before publishing.

MCP Apps resources use `text/html;profile=mcp-app` and `_meta.ui.resourceUri`, with the ChatGPT compatibility alias. The reader receives the inline page through tool result metadata and runs it inside the host sandbox without nested custom-component iframes. Conversation previews prefer the compressed local reader and selected dependencies. If that exceeds the chat budget, a published reader can carry only page data and import the reader from ShowAI's reader source (`reader.showai.renaissancemind.ai`, copied on demand from the npm release), jsDelivr or unpkg, whose origins the resource declares in its CSP. `delivery.compact` is the same few-kilobyte fragment for hosts where the model writes the HTML. Explicit `reader:"cdn"` exports stay online; `reader:"bundled"` and `SHOWAI_READER_CDN=off` prevent CDN fallback. Online loading starts a backup after 1.5 seconds, mounts only the first available reader and reports a failure after 15 seconds. Installing the plugin does not update the separate software runtime or populate the conversation host's browser cache. Text-only hosts can ignore the UI and use project receipts or HTML/source downloads. HTTP preview downloads expire after one hour and are capability URLs; retain the source or save into an authorized project for durable work.

The same skill source supports local and remote connections. For a remote package:

Generate an unbound universal package with `npm run package:plugin -- --out NEW_DIRECTORY`, or export the ZIP from desktop Settings → Plugins. Install the six Skills in the host and configure its MCP connection manually. The optional ChatGPT Personal export can reference a connection the user has already registered. A supplied `--mcp-url` is a manual setup hint in the README. See [Set up an agent](https://showai.renaissancemind.ai/doc/agent-hosts).

## Saved-page presentation contract

In the Antigravity auxiliary pane and the DeepSeek Harness session sidebar, opening a saved Page shows one editable Page with its own actions. The host manages the surrounding tabs. ShowAI's tab strip and project tree are hidden while editing. In DeepSeek Harness, select ShowAI in the left navigation to browse the full library with workspace tabs.

Install or update the Codex plugin from ShowAI **Settings → Plugins**. Use `show_component` for temporary, interactive results in chat. When the connection exposes `card_present`, finish a successful Page creation or edit with an original-Page card in the same reply. Use the saved `projectId` and `pageId`. The card shows the Page title and its full project and folder path. Its optional `description` (up to 1,000 characters) can summarize the new contents or the edit. Add a verified `blockId` from the saved outline to point to a particular component. An explicit inline reading preview uses `page_present`.

For several cards, pass the first target at the top level and the others in the ordered `additionalTargets` array of the same call. Each card has its own target and description. **Open in side panel** opens the original in a separate side tab or navigates its existing tab. The cards stay visible in chat when the tab opens or closes. To tune the layout, set `adjustSpacing:true` on the top-level call. Its controls preview spacing and send the chosen values back to the conversation when applied. The adjacent menu offers **Open in Workbench** and **Open in ShowAI App**, including the component location. For direct navigation, call `card_navigate` and use `card_open` if it reports `unavailable`. Use `workbench_page_reference` to deliver a local reference file.

Local and HTTP MCP share `page_present({projectId,pageId,blockIds?})`. It captures **one source revision**, returns identity/hash/revision, and **leaves the Page unchanged**. **Complete HTML/source contain the whole Page**; blockIds only selects the inline preview. Source and build intermediates use one snapshot, and temporary build directories are cleaned on failure.

Local delivery uses the host-configured `SHOWAI_PRESENTATION_DIR` or the runtime preview directory; HTTP delivery uses expiring artifact URLs.

Private source is not exposed by the anonymous presentation_source tool.

Local presentation reports synchronization.state=not_checked and does not start synchronization. HTTP project responses replace that with the verified synchronization receipt. A preview never creates another **source Page**. Low-level page_export retains its existing explicit-file semantics: selecting blocks makes that export and source partial.

The local plugin launcher resolves only its configured library, probes the registered runtime for capabilities.agentOperations.protocol=showai-mcp-v1, and launches MCP. It never falls back to another runtime after a failed probe. The embedded AgentHost supplies a bound MCP and removes the library launcher from its private skill copy.

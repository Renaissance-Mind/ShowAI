# One ShowAI workflow across Agent hosts

**Language:** English | [简体中文](i18n/agent-integration.zh-CN.md) · [Documentation](README.md)

**Agent document operations use MCP** in every host. Start with `guide()` for the shared entrypoint, then inspect `showai_capabilities` and the selected project context. Local plugins include a stdio launcher; remote packages provide an HTTP endpoint. CLI examples below configure services or support scripts and operators. They are not an alternate Agent authoring workflow.

Local library MCP uses explicit `projectId` per operation. Use `projects_list` for read-only discovery, `project_resolve` with a trusted absolute `sourceDirectory` for new formal content, or a project-bound connection. New formal work is **saved before** `page_present`; `render_document` is for explicitly standalone deliverables. **Connection failure** does not change the destination or persistence mode.

ShowAI 0.9 provides independent presentations and shared-project work. **Display and synchronization are separate choices**:

| Host display       | No synchronization                                                         | Shared project                                                                                    |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Inline or MCP Apps | Customize public components/templates, render, deliver HTML/inline/source. | Read/write the authorized project, confirm sync, optionally present it.                           |
| Text only          | Deliver files, or write a same-machine local project.                      | Read/write and return a synchronization receipt. People see the result in their ShowAI workbench. |

The page model, component compiler, authoring service, revision checks, export reader and sync protocol are shared. Hosts adapt how they invoke tools and show results. Supporting MCP alone does not imply HTML display support. Claude, pi, dsh and other hosts can use the documented CLI or MCP interfaces according to their actual capabilities; host-specific live acceptance is recorded separately.

## Local use

Find the actual runtime under **Settings → Plugins** (**Registered runtime** and the launch configuration) or in the selected library's `agent-runtime.json`. `showai` below abbreviates that executable and its arguments. Inspect `runtime info --json` and `guide integration --json`.

```sh
showai public list --kind component --query chart --json
showai public describe chart --view schema --json
showai public describe explainer --kind template --view source --json
showai render --input presentation.json --out /absolute/output/page.html --json
showai mcp --public
showai mcp --project PROJECT_ID
```

Public rendering does not initialize or modify a personal project. Input is `{document?, templateId?, title?, componentSources?, blockIds?}`; choose document or templateId. Components use the existing editable package contract: manifest, schema, source and optional files/assets. The renderer compiles in an isolated temporary workspace and removes that workspace afterward. Its receipt reports `savedToProject: false` and `synchronized: false`. Exported HTML, inline and source remain at the requested destination. Custom nodes use `attrs.kind="custom"` with `attrs.data={componentId,version,props}`; unregistered widget kinds fail with a corrective error. Public source output retains the original componentSources for customization. If inline exceeds the host limit, complete HTML/source are still returned; use blockIds for a smaller inline selection while retaining the full source.

Library stdio (`showai mcp`) adds `projects_list`, `project_resolve` and `project_create`. Project-bound stdio keeps the existing project tool names and also exposes public resources/rendering. `mcp --public` exposes only public resources, guides and rendering. Local rendering results include paths in the selected library's `local/agent-previews/`, outside synchronized project content.

For local project work, keep the usual read → modify with hash/revision → save → sync workflow. Scripts can run `sync run --project PROJECT --json`; MCP Agents use `project_sync` and `project_sync_status`. No HTML display is required to complete a project operation. An explicitly scoped synchronization enrolls and processes only that project; the full background run continues following the library's default policy.

## Remote MCP

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

Public tools are `showai_capabilities`, `guide`, `public_catalog_list`, `public_catalog_describe`, `render_document` and `presentation_source`. The last tool retrieves the editable public render input in text chunks when a host cannot download the HTTP URL; it does not expose private project exports. The catalog includes built-in components and editable starter templates. All public rendering inputs come from the caller; no anonymous operation reads the user's content library.

Private tools retain the existing authoring names, add an explicit `projectId`, and use OAuth. `projects_list` queries current server membership on every call. Selected-project grants remain restricted to their original IDs; account grants include later projects. `project_create` requires account authorization and the separate `projects.create` scope; it creates and synchronizes the project, returns its server ID, and accepts an operationId UUID for retrying the same request. `page_present` supplies the same reader as public rendering. Local path-based import, whole-site publication and local recovery tools stay local; remote component customization uses `component_save` with source. Remote exports use service-owned temporary paths and return downloadable artifacts instead of server filesystem paths.

### Permissions and synchronization

Each private call checks its token, consented project, scopes and current server role. The gateway serializes pull → operation → push in the grant's replica. Remote history records the entry as an external MCP client; it does not inherit the gateway launcher's Codex session. The response includes `synchronization.state`, `error` when present, and `remoteHead`. If a replica write succeeds but publication fails, the result is marked unsuccessful and the replica is retained. Cross-device conflicts keep both inputs as source-labeled pages; callers must use the returned page ID. Same-device stale writes continue to require deliberate conflict handling.

### Authorization

OAuth supports discovery, dynamic client registration, authorization code with S256 PKCE, resource binding, access-token expiry, rotating refresh tokens, consent and revocation. It authenticates existing ShowAI Server accounts; it does not create users during linking. GitHub and Google login use the explicitly configured server’s existing login providers. The user completes provider login in a separate tab, which then shows a one-time completion code; the user enters that code in the MCP authorization tab and continues to explicit project/account consent. The code binds the provider login to the tab that started it, so a forwarded provider link cannot sign in another client. The provider polling credential stays server-side. Existing accounts must bind the chosen provider first; linking does not silently create or merge accounts. Account/password login remains available; the password is forwarded only to the explicitly configured server and is not stored. Upstream session credentials are held in private state to perform the consented project operations.

## ChatGPT and other display hosts

For the official endpoint, account setup, consent and connection updates, see [ChatGPT web setup](chatgpt.md). Template-stage guidance and exact parameter queries are described in [template folders](template-bundles.md) and [component parameters](component-parameters.md).

In ChatGPT's plugin directory, add a custom MCP server using the `/mcp` URL and choose **OAuth or no authentication**. Anonymous tools remain available without linking; private calls request the appropriate project scopes. Test the tools in the host before publishing.

MCP Apps resources use `text/html;profile=mcp-app` and `_meta.ui.resourceUri`, with the ChatGPT compatibility alias. The reader receives the inline page through tool result metadata and runs it inside the host sandbox without nested custom-component iframes. Conversation previews prefer the compressed local reader and selected dependencies. If that exceeds the chat budget, a published reader can carry only page data and import the reader from ShowAI's reader source (`reader.showai.renaissancemind.ai`, copied on demand from the npm release), jsDelivr or unpkg, whose origins the resource declares in its CSP. `delivery.compact` is the same few-kilobyte fragment for hosts where the model writes the HTML. Explicit `reader:"cdn"` exports stay online; `reader:"bundled"` and `SHOWAI_READER_CDN=off` prevent CDN fallback. Online loading starts a backup after 1.5 seconds, mounts only the first available reader and reports a failure after 15 seconds. Installing the plugin does not update the separate software runtime or populate the conversation host's browser cache. Text-only hosts can ignore the UI and use project receipts or HTML/source downloads. HTTP preview downloads expire after one hour and are capability URLs; retain the source or save into an authorized project for durable work.

The same skill source supports local and remote connections. For a remote package:

```sh
npm run package:plugin -- --mcp-url https://agent.example.com/mcp --out /absolute/new/showai-plugin
```

The output creates a `showai-cloud` package from the same Skills/assets, with HTTP/OAuth configuration instead of the local launcher. Archive that directory for the target host's plugin upload or public submission. Local installation continues using `npm run plugin:update -- --json`; it does not force every local Agent through a remote service. Public publication, organization verification and review are separate from local or personal-plugin testing.

## Saved-page presentation contract

Local and HTTP MCP share `page_present({projectId,pageId,blockIds?})`. It captures **one source revision**, returns identity/hash/revision, and **leaves the Page unchanged**. **Complete HTML/source contain the whole Page**; blockIds only selects the inline preview. Source and build intermediates use one snapshot, and temporary build directories are cleaned on failure.

Local delivery uses the host-configured `SHOWAI_PRESENTATION_DIR` or the runtime preview directory; HTTP delivery uses expiring artifact URLs.

Private source is not exposed by the anonymous presentation_source tool.

Local presentation reports synchronization.state=not_checked and does not start synchronization. HTTP project responses replace that with the verified synchronization receipt. A preview never creates another **source Page**. Low-level page_export retains its existing explicit-file semantics: selecting blocks makes that export and source partial.

The local plugin launcher resolves only its configured library, probes the registered runtime for capabilities.agentOperations.protocol=showai-mcp-v1, and launches MCP. It never falls back to another runtime after a failed probe. The embedded AgentHost supplies a bound MCP and removes the library launcher from its private skill copy.

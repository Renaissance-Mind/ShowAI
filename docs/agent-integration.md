# One ShowAI workflow across Agent hosts

ShowAI 0.9 provides independent presentations and shared-project work. Display and synchronization are separate choices:

| Host display | No synchronization | Shared project |
| --- | --- | --- |
| Inline or MCP Apps | Customize public components/templates, render, deliver HTML/inline/source. | Read/write the authorized project, confirm sync, optionally present it. |
| Text only | Deliver files, or write a same-machine local project. | Read/write and return a synchronization receipt. People see the result in their ShowAI workbench. |

The page model, component compiler, authoring service, revision checks, export reader and sync protocol are shared. Hosts adapt how they invoke tools and show results. Supporting MCP alone does not imply HTML display support. Claude, pi, dsh and other hosts can use the documented CLI or MCP interfaces according to their actual capabilities; host-specific live acceptance is recorded separately.

## Local use

Find the actual runtime in the desktop's Connect Agent settings or the selected library's `agent-runtime.json`. `showai` below abbreviates that executable and its arguments. Inspect `runtime info --json` and `guide integration --json`.

```sh
showai public list --kind component --query chart --json
showai public describe chart --view schema --json
showai public describe explainer --kind template --view source --json
showai render --input presentation.json --out /absolute/output/page.html --json
showai mcp --public
showai mcp --project PROJECT_ID
```

Public rendering does not initialize or modify a personal project. Input is `{document?, templateId?, title?, componentSources?, blockIds?}`; choose document or templateId. Components use the existing editable package contract: manifest, schema, source and optional files/assets. The renderer compiles in an isolated temporary workspace and removes that workspace afterward. Its receipt reports `savedToProject: false` and `synchronized: false`. Exported HTML, inline and source remain at the requested destination. Custom nodes use `attrs.kind="custom"` with `attrs.data={componentId,version,props}`; unregistered widget kinds fail with a corrective error. Public source output retains the original componentSources for customization. If inline exceeds the host limit, complete HTML/source are still returned; use blockIds for a smaller inline selection while retaining the full source.

Project-bound stdio keeps the existing project tool names and also exposes public resources/rendering. `mcp --public` exposes only public resources, guides and rendering. Local rendering results include paths in the selected library's `local/agent-previews/`, outside synchronized project content.

For local project work, keep the usual read → modify with hash/revision → save → sync workflow. CLI-only Agents can run `sync run --project PROJECT --json`; project-bound stdio clients use `project_sync` and `project_sync_status`. No HTML display is required to complete a project operation. An explicitly scoped synchronization enrolls and processes only that project; the full background run continues following the library's default policy.

## Remote MCP

Run the agent gateway with the independently installed ShowAI runtime. It uses Node.js and the same compiler/reader assets as the CLI. It is separate from the content synchronization server; the sync server continues storing snapshots and objects without executing components.

```sh
showai mcp serve \
  --state /absolute/private/showai-agent-state \
  --host 127.0.0.1 --port 8789 \
  --public-url https://agent.example.com \
  --sync-server https://content.example.com
```

Use a stable HTTPS reverse proxy for the public URL. The MCP URL is `https://agent.example.com/mcp`; `/health` reports readiness without exposing private paths or credentials. `--sync-server` accepts a comma-separated list of deployment-approved ShowAI Server base URLs (including prefixes such as /cloud). With no sync server configured, public rendering remains usable. The OAuth login page lets users select one configured server and explicitly authorize one project; another project can use another account connection.

`--state` contains the private OAuth database and per-grant project replicas. Restrict it to the service account. Its tokens and replicas must not be published or copied into the plugin. Reverse proxies must preserve the public Host. `--widget-domain` can declare the dedicated UI origin required for public plugin submission. Local development permits a loopback HTTP public URL; published connections require HTTPS.

Public tools are `showai_capabilities`, `guide`, `public_catalog_list`, `public_catalog_describe`, `render_document` and `presentation_source`. The last tool retrieves the editable public render input in text chunks when a host cannot download the HTTP URL; it does not expose private project exports. The catalog includes built-in components and editable starter templates. All public rendering inputs come from the caller; no anonymous operation reads the user's content library.

Private tools retain the existing authoring names, add an explicit projectId, and use OAuth. `projects_list` returns only the project authorized in that grant and checks current server membership. `page_present` supplies the same reader as public rendering. Local path-based import, whole-site publication and local recovery tools stay local; remote component customization uses `component_save` with source. Remote exports use service-owned temporary paths and return downloadable artifacts instead of server filesystem paths.

Each private call checks its token, consented project, scopes and current server role. The gateway serializes pull → operation → push in the grant's replica. Remote history records the entry as an external MCP client; it does not inherit the gateway launcher's Codex session. The response includes `synchronization.state`, `error` when present, and `remoteHead`. If a replica write succeeds but publication fails, the result is marked unsuccessful and the replica is retained. Cross-device conflicts keep both inputs as source-labeled pages; callers must use the returned page ID. Same-device stale writes continue to require deliberate conflict handling.

OAuth supports discovery, dynamic client registration, authorization code with S256 PKCE, resource binding, access-token expiry, rotating refresh tokens, consent and revocation. It authenticates existing ShowAI Server accounts; it does not create users during linking. The login password is forwarded only to the explicitly configured server and is not stored. Upstream session credentials are held in private state to perform the consented project operations.

## ChatGPT and other display hosts

In ChatGPT's plugin directory, add a custom MCP server using the `/mcp` URL and choose **OAuth or no authentication**. Anonymous tools remain available without linking; private calls request the appropriate project scopes. Test the tools in the host before publishing.

MCP Apps resources use `text/html;profile=mcp-app` and `_meta.ui.resourceUri`, with the ChatGPT compatibility alias. The reader receives the bundled inline page through tool result metadata and runs it inside the host sandbox. No network dependencies or nested custom-component iframes are needed. Text-only hosts can ignore the UI and use project receipts or HTML/source downloads. HTTP preview downloads expire after one hour and are capability URLs; retain the source or save into an authorized project for durable work.

The same skill source supports local and remote connections. For a remote package:

```sh
npm run package:plugin -- --mcp-url https://agent.example.com/mcp --out /absolute/new/showai-plugin
```

The output adds `mcp.json` to the same manifest, skills and assets. Archive that directory for the target host's plugin upload or public submission. Local installation continues using `npm run plugin:update -- --json`; it does not force every local Agent through a remote service. Public publication, organization verification and review are separate from local or personal-plugin testing.

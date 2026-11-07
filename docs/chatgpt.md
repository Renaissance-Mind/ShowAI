# Connect local ShowAI to ChatGPT

**Language:** English | [简体中文](i18n/chatgpt.zh-CN.md) · [Documentation](README.md)

Open **Settings → Remote connection** in the desktop App. The connection wizard leads through choosing a provider, establishing a connection, and pairing a client. ShowAI must remain running on an awake, connected computer.

## Choose a provider

**Cloudflare** offers a temporary connection without an account or a fixed hostname using your own Cloudflare tunnel. **Tailscale** uses your signed-in Tailscale account and the device's `ts.net` address.

New connections default to full access to all current and future projects, including remote project creation. Use **Access rules** to restrict the connection to specified projects and assign read-only or full access. Explicit access rules are preserved until changed. Older configurations without an access mode use the new full-library default. Clients previously authorized for selected projects pair again when expanding their grant to the whole library, including when explicit access rules are changed.

## Establish the connection

For a temporary Cloudflare connection, choose **Create a temporary connection**, then **Download and connect** or **Connect**. ShowAI downloads and verifies the official connector if needed, binds an available local port and starts the tunnel. Its address changes on reconnect. Quick Tunnel has no availability guarantee; the MCP uses JSON responses without depending on SSE.

For your own Cloudflare domain, choose **Connect your domain**:

1. **Copy local address** copies a live, reserved listener's address.
2. **Open Cloudflare dashboard**. Create a Cloudflared Tunnel and a Published application route pointing to that HTTP service address. Return and choose **Route configured — continue**.
3. Enter the HTTPS hostname and that tunnel's token, then connect. Tokens are encrypted with the operating system's credential storage. No account API key is needed.

The setup reuses the saved fixed-route port when available. If it is occupied, ShowAI reserves a different free port and takes you through updating the Cloudflare route. It never terminates the other program. Temporary Cloudflare and Tailscale connections always forward the actual automatically assigned local port. The listener stays bound while its public URL is configured.

For Tailscale, use the in-step actions to **Install and sign in to Tailscale**, **Open network settings** and enable MagicDNS, HTTPS and Funnel permission, then **Signed in — check and connect**. A pre-existing Funnel on public port 443 is preserved and reported; resolve that route in your own Tailscale account or use a dedicated device.

On a failure, the current step offers a retry or return to configuration. **View diagnostics** contains the underlying provider error. A public check must succeed before the wizard advances to client pairing.

## Connect ChatGPT

After the public connection check succeeds, copy the MCP URL and create a custom MCP connection in ChatGPT using the in-step form guide. Open its plugin page and copy the complete browser URL. Choose **Download ChatGPT plugin ZIP** in ShowAI and paste this page link once. ShowAI remembers the binding for the current endpoint. The ZIP includes all six Skills, references, icons and the registered ChatGPT connection mapping, with no local launcher, project content or credentials. Import it in ChatGPT Plugins to use the complete **ShowAI Personal** plugin. A ZIP containing only a portable HTTP MCP declaration is currently classified as desktop-only by ChatGPT; the registered connection mapping is required for web use. Plugin upload availability depends on the account and workspace policy.

The authorization page displays **Waiting for approval in ShowAI** and a connection number. Return to the desktop App: its connection dialog appears wherever you are in the workbench. Match the number, check the requesting client, callback origin and access scope, then choose **Allow connection**. The page automatically returns to ChatGPT. A request expires after ten minutes; denying or canceling it grants no access. The client name is supplied by the requesting client; matching the number identifies the request you just started.

Choose **Try in chat** on the installed plugin, or mention it in a new chat and send the verification prompt from ShowAI. The wizard completes after a real authenticated tool call succeeds. Installation, authorization and successful tool use are separate checks. Use **Connect another client** to add one later, and revoke individual clients from the connected view.

If the authorization window expires, start connecting again in ChatGPT and approve the new request in ShowAI. Each request is handled once. Restarting the service cancels pending requests while retaining existing valid grants.

**Enter the MCP URL manually** remains available for an existing custom connection or another client. In ChatGPT choose **Server URL**, **OAuth**, and **Dynamic Client Registration (DCR)**. Client credentials are registered automatically. Keep discovered scopes selected and base scopes empty. If discovery fails, use **Retry metadata discovery** in ChatGPT. ShowAI's recovery dialog provides the exact endpoint fields. Both Cloudflare and Tailscale use the Server URL option. CIMD and OIDC being unavailable is expected; PKCE uses S256. A duplicate plugin name needs a device suffix; an already created plugin can be reopened to continue connecting.

Choose **Other MCP client** for an HTTP/OAuth-capable client on another computer. That computer does not need tunnel software. The connected view lets you copy the address, connect another client, revoke a client's grant or disconnect.

Pages save directly in the local ShowAI library with normal version and conflict checks. Full-library grants automatically discover later projects; `project_create` creates a local project. Reuse the same operationId and name only when retrying the same creation after an uncertain response. Cloud synchronization, if configured separately, has its own status.

Quitting the App closes its listener and connector. Enabled connections restore on the next App launch and retry transient failures. Choosing Disconnect disables restoration. Fixed hostnames retain full-library grants across normal restarts; changed temporary addresses require an updated client address or a newly exported plugin and renewed authorization. Refresh the client's MCP tools after an App update changes capabilities. If a save was interrupted, read the Page after reconnecting before retrying. Preview links expire after one hour; the saved Page remains the source.

Provider references: [Cloudflare setup](https://developers.cloudflare.com/tunnel/get-started/), [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel). Separately administered cloud gateways are covered in [MCP deployment](cloud-mcp-deployment.md).

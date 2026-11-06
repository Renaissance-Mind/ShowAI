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

Keep ShowAI open. Copy the MCP URL, then open ChatGPT's **Plugins → Add → Add custom MCP server**. The available entry depends on the account and workspace policy. Fill the form as follows:

| Field | Value |
| --- | --- |
| Name | **ShowAI Local**, or a unique name identifying this computer |
| Connection | **Server URL**, using the MCP URL copied from ShowAI |
| Authentication | **OAuth** |
| Advanced OAuth settings → Registration method | **Dynamic Client Registration (DCR)** |
| Client ID / Client Secret | Automatically registered; no manual values needed |
| Default requested scopes | Keep the discovered selection; full access includes `projects.read`, `projects.write` and `projects.create` |
| Base scopes | Leave empty |

Both Cloudflare and Tailscale Funnel use **Server URL** in this form. If metadata discovery fails, click **Retry metadata discovery** in the advanced OAuth settings. Successful discovery makes DCR available and fills the endpoint fields. ShowAI's **Resolve discovery failure** action shows the exact values for the current connection, with copy buttons. For a server at `https://your-host/mcp`, the authorization, token and registration URLs end in `/oauth/authorize`, `/oauth/token` and `/oauth/register`; the authorization server base is `https://your-host` and the resource is the full MCP URL. PKCE uses S256. CIMD and OIDC being unavailable is expected.

If discovery still fails, keep the App running and check public tunnel access. A check from your own computer does not establish that ChatGPT can reach it. Manual endpoint values cannot repair a network failure.

Review the warning and permissions, acknowledge them, then choose **Create as plugin**. If the name is already taken, add your device name. Open the newly created plugin and choose **Connect** or **Continue connecting app**. If you close the dialog accidentally, reopen that plugin from **Personal** or **Installed** and continue connecting it.

When ChatGPT opens **Connect local ShowAI**, return to ShowAI and choose **ShowAI authorization page is open — continue**, then **Generate pairing code**. Copy it into the authorization page's **Pairing code** field and click **Authorize**. The code expires after ten minutes and works once. ShowAI shows its remaining time and retires expired, used or replaced codes. Use **Generate a new pairing code** when needed.

The authorization window also expires independently. If it has expired, return to the client and start connecting again before entering a valid pairing code. Generating a new code does not renew the old authorization window. Put the code only into the ShowAI authorization page, never into the OAuth Client Secret field or a chat message.

After connecting, choose **Try in chat** on this plugin, or mention its exact name with `@` in a new chat. Send the verification prompt copied from ShowAI. A successful authenticated tool call completes the setup; installation alone does not verify access.

Choose **Other MCP client** for an HTTP/OAuth-capable client on another computer. That computer does not need tunnel software. The connected view lets you copy the address, connect another client, revoke a client's grant or disconnect.

Pages save directly in the local ShowAI library with normal version and conflict checks. Full-library grants automatically discover later projects; `project_create` creates a local project. Reuse the same operationId and name only when retrying the same creation after an uncertain response. Cloud synchronization, if configured separately, has its own status.

Quitting the App closes its listener and connector. Fixed hostnames retain full-library grants across normal restarts; changed temporary addresses require client configuration and pairing again. Refresh the client's MCP tools after an App update changes capabilities. If a save was interrupted, read the Page after reconnecting before retrying. Preview links expire after one hour; the saved Page remains the source.

Provider references: [Cloudflare setup](https://developers.cloudflare.com/tunnel/get-started/), [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel). Separately administered cloud gateways are covered in [MCP deployment](cloud-mcp-deployment.md).

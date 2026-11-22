# Connect devices and MCP clients to ShowAI

**Language:** English | [简体中文](i18n/chatgpt.zh-CN.md) · [Documentation](README.md)

Open **Settings → Remote MCP** in the desktop App. Choose the network, start the service, then connect your client. ShowAI must remain running on an awake, connected computer.

## Choose the network

| Mode | Who can connect | Connection |
| --- | --- | --- |
| Local network | Devices on the same Wi-Fi or Ethernet | Direct HTTP with an access key |
| Tailscale private network | Devices on the same tailnet, subject to its access rules | Private HTTPS with device approval or OAuth |
| Public access → Cloudflare temporary | Internet clients, including ChatGPT web | Temporary HTTPS tunnel and OAuth |
| Public access → Cloudflare fixed domain | Internet clients using your own hostname | Your Cloudflare tunnel and OAuth |
| Public access → Tailscale Funnel | Internet clients outside the tailnet | Public HTTPS through Funnel and OAuth |

ChatGPT web connects from its cloud service and needs a public address. A client running on your other device can use its local network or tailnet directly.

New connections default to full access to all current and future projects, including remote project creation. Use **Access rules** to restrict the connection to specified projects and assign read-only or full access. Explicit access rules are preserved until changed. Older configurations without an access mode use the new full-library default. When expanding permissions, OAuth clients authorize again and local network clients create and enter a new access key; existing keys do not gain broader access.

## Establish the connection

For **Local network**, select the computer's network address and choose **Start local network connection**. Only that interface is bound. Copy the MCP URL into your client, choose Streamable HTTP, name the client in ShowAI, and create its access key. Paste the key into the client's Bearer Token field or `Authorization: Bearer <key>` header. Keys are shown once, stored as hashes, expire after 90 days, and can be revoked separately. HTTP is intended for a trusted local network; choose Tailscale private network for HTTPS. Clients that require HTTPS/OAuth cannot use this HTTP mode. The computer's service check does not establish reachability from another device; complete a real client call.

For **Tailscale private network**, join both devices to the same tailnet and enable MagicDNS and HTTPS. New connections use **Device approval**. Start the connection, select **Copy setup prompt**, and send the prompt to an agent that can configure MCP. ShowAI displays the device and owner verified by Tailscale. Select **Allow connection**. Agents on that device share the grant. You can revoke it under **Clients**. MCP requests and approval stay inside the private network.

For Grok Bot, send the setup prompt to the bot. It registers a **Command / stdio** connector that runs `mcp-remote` on its Tailscale device and calls the private ShowAI HTTPS endpoint. Confirm the addition in Grok if prompted. The Mac uses the same device approval for this connection. Other clients with remote HTTP support can use the URL directly.

Existing private OAuth connections keep their previous settings. Select **Device approval** under **Network → Authentication** and save to switch. Private OAuth uses Tailscale Serve and advertises its discovery URL with HTTP 401. On a trusted LAN, the setup prompt includes a single-use invitation valid for ten minutes. An agent with local credential storage and configurable request headers can enroll itself and request approval in ShowAI.

For **Public access**, choose a tunnel. **Cloudflare temporary connection** downloads and verifies the official connector if needed, reserves a local port and starts the tunnel. Its URL changes on reconnect. Quick Tunnel has no availability guarantee; MCP uses JSON responses without depending on SSE.

For your own Cloudflare domain, choose **Cloudflare fixed domain**:

1. **Copy local address** copies a live, reserved listener's address.
2. **Open Cloudflare dashboard**. Create a Cloudflared Tunnel and a Published application route pointing to that HTTP service address. Return and choose **Route configured — continue**.
3. Enter the HTTPS hostname and that tunnel's token, then connect. Tokens are encrypted with the operating system's credential storage. No account API key is needed.

The setup reuses the saved fixed-route port when available. If it is occupied, ShowAI reserves a different free port and takes you through updating the Cloudflare route. It never terminates the other program. Temporary Cloudflare and Tailscale Serve or Funnel connections forward the actual automatically assigned local port. The listener stays bound while its public URL is configured.

For **Tailscale public access (Funnel)**, sign in to Tailscale and enable MagicDNS, HTTPS and Funnel permission. Serve and Funnel reserve an unused HTTPS port from 443, 8443 and 10000. Existing routes are preserved; stopping ShowAI stops only its own foreground connector. If all ports are occupied, the actual error is shown instead of replacing another service.

A failure stays at the connection step with retry and diagnostics. The address must pass the service check before client setup. Only a successful authenticated client call completes the flow.

## Connect another MCP client

Select **Copy setup prompt** and send it to your agent. For a manual connection, use the displayed MCP URL and Streamable HTTP. Leave the authentication fields empty for Tailscale device approval, enter the access key for LAN mode, or select OAuth for an OAuth connection. For OAuth, initiate the connection in your client, then match the connection number in the desktop ShowAI dialog and select **Allow connection**. Return to your client and send the verification prompt or call `projects_list`. Client names, callback origin and access scope are shown for approval. Requests expire after ten minutes; restarting cancels pending requests and preserves valid grants.

## Connect ChatGPT

To get the six Skills before connecting, choose **Settings → Agent plugins** or generate a universal package (`npm run package:plugin`). Add MCP separately in the host and ask the Agent to help you connect. If you already registered a ChatGPT connection, the optional Personal export below can reference it.

Choose **ChatGPT** after a public connection passes its check. The guide has three steps:

1. **Server**: open ChatGPT Plugins → Add → Add custom MCP server. Enter the name, select Server URL, paste the MCP URL and select OAuth.
2. **OAuth**: select Dynamic Client Registration (DCR). Client credentials register automatically. Keep discovered scopes selected and base scopes empty. If discovery fails, use Retry metadata discovery; the help dialog can recheck the service and show exact OAuth endpoints.
3. **Connect**: create the plugin and select Connect or Continue linking app. Once the ShowAI authorization page opens, approve the matching request in the desktop App. Use the plugin in a chat and send the verification prompt.

An existing plugin can be reopened to connect again. A duplicate name can use a device suffix. If an authorization window expires, start a new request in ChatGPT and approve it in ShowAI.

Install the complete ShowAI Skills for Agent workflows using **Install complete Skills (optional)**, which exports the full ShowAI Personal plugin. First create the MCP connection above; open its plugin page and give that complete page link to the export dialog once. The ZIP includes six Skills, references, icons and the registered connection mapping, without a local launcher, project content or credentials. Import it from ChatGPT Plugins. Plugin upload depends on account and workspace policy; importing a ZIP alone does not prove successful authorization or tool use.

Pages save directly in the local ShowAI library with normal version and conflict checks. Full-library grants automatically discover later projects; `project_create` creates a local project. Reuse the same operationId and name only when retrying the same creation after an uncertain response. Cloud synchronization, if configured separately, has its own status.

Quitting the App closes its listener and connector. Enabled connections restore on the next App launch and retry transient failures. Choosing Disconnect disables restoration. Fixed hostnames retain full-library grants across normal restarts; changed temporary addresses require an updated client address or a newly exported plugin and renewed authorization. Refresh the client's MCP tools after an App update changes capabilities. If a save was interrupted, read the Page after reconnecting before retrying. Preview links expire after one hour; the saved Page remains the source.

### Edit original pages in ChatGPT Work

The desktop remote connection provides original-Page cards and the ShowAI conversation panel and global workbench on Work clients that expose these extensions. Open a saved card to edit its Page or Board. The global workbench lists the projects approved for this connection. Edits use the original Page and its current revision. A read-only grant opens the same Page in reading mode. Classic ChatGPT can display the inline MCP Apps when available. It uses the available links for additional navigation. [OpenAI extension support](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#platform-support)

Provider references: [Cloudflare setup](https://developers.cloudflare.com/tunnel/get-started/), [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel). Separately administered cloud gateways are covered in [MCP deployment](cloud-mcp-deployment.md).

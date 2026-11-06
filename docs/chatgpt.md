# Use your local ShowAI from ChatGPT

**Language:** English | [简体中文](i18n/chatgpt.zh-CN.md) · [Documentation](README.md)

The desktop App can expose selected local projects through **Settings → Remote connection**. Use your own Cloudflare tunnel or Tailscale account. Pages remain in the computer's library; remote edits use the same saved revisions and conflict checks as local edits. The computer must stay awake, online and running ShowAI.

## Choose a connection

| Connection | What you provide | Address |
| --- | --- | --- |
| Cloudflare temporary | Install `cloudflared` | Generated `trycloudflare.com` address; changes on reconnect |
| Cloudflare custom domain | Your Cloudflare account, domain and tunnel token | Your fixed HTTPS hostname |
| Tailscale Funnel | Install and sign in to your own Tailscale account | Your device's `ts.net` hostname |

Cloudflare Quick Tunnels are for development, have no availability guarantee and do not support SSE. ShowAI's HTTP MCP returns JSON responses. Funnel has provider bandwidth limits. Provider availability and pricing apply to the user's account.

## Cloudflare temporary URL

1. In Remote connection click **Download connector** to install the official cloudflared binary into the App profile after SHA-256 verification. Alternatively, install [cloudflared](https://developers.cloudflare.com/tunnel/downloads/) for your operating system. On macOS with Homebrew, run `brew install cloudflared`.
2. Open **Settings → Remote connection**, select **Cloudflare → Temporary URL**, and **Check tools**. If detection fails, choose the executable under **Connection settings**.
3. Select the projects to expose and set each permission. Start the connection.
4. Wait for the public check to pass, then copy the MCP URL. If it fails, read the reported error and check again after the connector establishes its route.

ShowAI runs and stops its own foreground connector. Existing user-managed tunnels are not stopped or reconfigured. Cloudflared's existing default configuration may interfere with Quick Tunnel; follow the provider's Quick Tunnel instructions if it reports a configuration conflict.

## Cloudflare custom domain

First download or locate cloudflared using **Download connector** / **Check tools** as described above.

1. In your [Cloudflare dashboard](https://dash.cloudflare.com/), create a Cloudflared Tunnel. Copy its **tunnel token**, not your account API key. Do not start another connector with that token on this computer.
2. Add a **Published application** route. Choose your subdomain, set the service type to HTTP and its address to the local route target shown in ShowAI, for example `127.0.0.1:18789`.
3. In ShowAI choose **Custom domain**, enter the HTTPS hostname and tunnel token, select projects, and start. ShowAI stores the token using the operating system's credential encryption. It never returns the tunnel token to MCP clients.
4. Check that the public address reaches this instance. Do not place an interactive Cloudflare Access login in front of MCP: ShowAI handles client authorization with OAuth.

If the local port is occupied, choose another port and update the Cloudflare route to match. See [Cloudflare setup](https://developers.cloudflare.com/tunnel/get-started/).

## Tailscale Funnel

1. Install [Tailscale](https://tailscale.com/download), sign in to your own account, and check that the device is online.
2. Follow the [Funnel guide](https://tailscale.com/docs/features/tailscale-funnel) to enable MagicDNS, HTTPS and Funnel permission in your tailnet. Complete account-owner approvals yourself.
3. Select **Tailscale** in ShowAI and check tools. Select projects and start the connection.
4. ShowAI forwards the local MCP through a foreground Funnel process on public port 443. If that port already serves another application, it reports the conflict without replacing that route. Use a dedicated device or resolve the existing route in Tailscale yourself.
5. Check public reachability and copy the MCP URL. Changing the device or tailnet name changes the address.

Funnel publishes an internet-accessible URL. Tailscale membership does not authenticate visitors to that URL; ShowAI OAuth protects project operations.

## Connect ChatGPT or another MCP client

1. In [ChatGPT Plugins](https://chatgpt.com/plugins), choose **Add custom MCP server**. Paste ShowAI's MCP URL, including `/mcp`, and choose OAuth. Account and workspace policies govern availability.
2. Use Dynamic Client Registration when prompted; leave Client ID and Client Secret blank.
3. In ShowAI click **Generate pairing code**. Enter the code on the ShowAI authorization page opened by ChatGPT, review the requested permissions, and authorize. The code expires after ten minutes and is consumed once. Do not send it to the chat model.
4. Install/select the plugin and ask it to list projects. **Last tool call** in ShowAI confirms a successful authenticated tool call; a successful health check alone does not prove the client has connected.
5. Ask the agent to create or edit a page in an authorized project. The saved source appears directly in this computer's ShowAI library. Cloud synchronization, if configured separately, has its own status.

Other clients supporting Streamable HTTP MCP and OAuth can use the same URL and pairing flow. The client computer does not need Cloudflare or Tailscale installed. Each client has a separate grant that can be revoked in ShowAI.

## Permissions and recovery

- New projects are not automatically authorized. Create them in the App, select them in Remote connection, then reconnect the client to authorize them.
- Read-only projects reject writes even if a client requested an editing scope. Removing a project from the device configuration removes its access for existing grants.
- Stop the connection before changing provider, address or project permissions. Quitting ShowAI stops its MCP listener and connector. Starting the App does not automatically publish a service.
- With a fixed address, OAuth grants survive a normal stop/start. A changed Quick URL requires a new client address and pairing.
- After changing tools or authentication metadata, refresh the custom MCP in ChatGPT and start a new chat.
- If a save was interrupted, read the page after reconnecting before retrying. Never assume that a timeout means no write occurred.
- Preview/download links expire after one hour. Keep the saved Page as the source of truth.

The separately administered cloud gateway remains documented in [MCP deployment](cloud-mcp-deployment.md). Its server-account authorization and synchronization differ from the desktop connection described here.

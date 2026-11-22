# ShowAI for Claude Code

[简体中文](README.zh-CN.md)

Sessions with an HTML display tool can show interactive previews and page cards. Desktop sessions can edit the original in an available browser or preview. Terminal sessions deliver an HTML file and a page link.

Install or update the Claude Code plugin in ShowAI under Settings → Agent plugins and restart the session. Check that ShowAI is enabled in the plugin manager and connected in the MCP status view.

In a new session, call `showai_capabilities` to check the connection and `projects_list` to see the projects you can access.

For a source marketplace install, add the ShowAI repository to Claude Code and install `showai@renaissance-mind`. Use `npm run plugin:claude -- --port <port> --json` to bind a development instance.

[Connection guide](skills/use-showai/references/connect-mcp.md) · [Presentation and editing](skills/use-showai/references/host-adapter.md)

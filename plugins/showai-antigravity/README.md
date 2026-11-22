# ShowAI for Antigravity

[简体中文](README.zh-CN.md)

Show interactive previews and page cards in chat. Edit originals, navigate to components and quote selections in the auxiliary pane, or browse projects in the global workbench.

Install or update the Antigravity plugin in ShowAI under Settings → Agent plugins and restart the session. For a source install, make sure `agy` is available and run `npm run plugin:antigravity`.

In a new session, call `showai_capabilities` to check the connection and `projects_list` to see the projects you can access.

To bind a development instance, run `npm run plugin:antigravity -- --port <port> --json`. Use `--remove` to uninstall that plugin.

[Connection guide](skills/use-showai/references/connect-mcp.md) · [Presentation and editing](skills/use-showai/references/host-adapter.md)

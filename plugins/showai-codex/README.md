# ShowAI for Codex

[简体中文](README.zh-CN.md)

Interact with previews in chat. Open a saved page card to edit the original or jump to a component in the side panel. Desktop builds with plugin extensions also offer a global workbench and selection references in chat.

Install or update the Codex plugin in ShowAI under Settings → Agent plugins. Refresh plugins or restart Codex, then start a new chat. From a source checkout, run `npm run plugin:install`.

In a new session, call `showai_capabilities` to check the connection and `projects_list` to see the projects you can access.

After a source install, run `npm run plugin:update -- --json` to update. The receipt records the version, enabled state and file fingerprint.

[Connection guide](skills/use-showai/references/connect-mcp.md) · [Presentation and editing](skills/use-showai/references/host-adapter.md)

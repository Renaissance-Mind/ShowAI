# ShowAI plugin

This plugin gives Codex and Claude Code a shared workflow for creating, revising and exporting interactive pages. It contains a skill, a compiled Node CLI, the offline reader, and the local component compiler. Authoring files live in `~/.showai` by default and are shared with the desktop application.

Build it from the repository with `npm run build`. The generated `assets/build.json` records its version and compiler platform. Node.js 22.12 or later is required. A plugin archive built on one OS/architecture carries that compiler; build on the target platform for component imports there.

For Codex, this repository exposes `.agents/plugins/marketplace.json`. Open the local marketplace in the Plugins panel and install ShowAI, then start a new conversation. A portable plugin root is `plugins/showai`.

For a copied build outside this repository, first place the plugin in a stable directory such as `~/.codex/plugins/showai`. For example, from a built source repository:

```sh
mkdir -p "$HOME/.codex/plugins/showai"
cp -R plugins/showai/. "$HOME/.codex/plugins/showai/"
```

A macOS desktop installation carries the same plugin at `/Applications/ShowAI.app/Contents/Resources/plugin`; copy that directory's contents instead when using the installed application.

If `~/.agents/plugins/marketplace.json` does not exist, create it with this content. If it already exists, add only the ShowAI entry to its existing `plugins` array and keep the existing marketplace name and other entries:

```json
{
  "name": "showai-local",
  "plugins": [
    {
      "name": "showai",
      "source": { "source": "local", "path": "./.codex/plugins/showai" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    }
  ]
}
```

Restart the Codex desktop application, find ShowAI in that local marketplace, install it, and start a new conversation. The source path is relative to the personal marketplace root (your home directory), not to `.agents/plugins/`.

For Claude Code, the repository also exposes `.claude-plugin/marketplace.json`. From the repository's parent directory:

```sh
claude plugin marketplace add ./ShowAI
claude plugin install showai@renaissance-mind
```

For development without installing: `claude --plugin-dir ./plugins/showai` from the ShowAI repository. Installing the plugin does not publish a site or change MCP server configuration.

The skill invokes `node /absolute/path/to/plugin/scripts/cli.mjs`. Every page operation explicitly selects a project, and every revision requires a previously read content hash. Optional MCP connections are configured per project; see `skills/show-document/references/agent-usage.md` in a built bundle or `docs/agent-usage.md` in the source repository.

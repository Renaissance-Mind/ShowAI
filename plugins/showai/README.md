# ShowAI plugin

This plugin gives Codex and Claude Code a shared workflow for creating, revising and exporting interactive pages. It contains a skill, a compiled Node CLI, the offline reader, and the local component compiler. Authoring files live in `~/.showai` by default and are shared with the desktop application.

Build it from the repository with `npm run build`. The generated `assets/build.json` records its version and compiler platform. Node.js 22.12 or later is required. A plugin archive built on one OS/architecture carries that compiler; build on the target platform for component imports there.

## Install and update in Codex

From the source repository, run:

```sh
npm run plugin:install
```

After changing the source or skill, refresh the installed plugin with:

```sh
npm run plugin:update
```

Both commands build the portable reader, Agent CLI and plugin package, then use the official Codex CLI to add this repository as a local marketplace and install or refresh `showai@renaissance-mind`. They do not build the desktop installer, pull Git changes, restart Codex, edit configuration text or automatically uninstall anything.

The helper reads `installedPath` from Codex's installation response, recursively compares source and installed file hashes (including executable status), and checks that Codex reports the plugin as enabled. The receipt is written to `artifacts/codex-plugin-install.json` in the repository. Start a new conversation after a successful update so the latest skill is loaded. Local development updates can keep the same plugin version because the installed bytes are verified.

A current Codex CLI with `codex plugin marketplace add` and `codex plugin add` is required. If the marketplace name is already assigned to a different source, the helper refuses to replace it. If installed bytes differ, it reports the mismatch and suggests the official remove/add commands for an explicit reinstall; it never deletes the installed plugin on its own.

The stable development source is this repository's `plugins/showai/` directory. Codex uses an installed cache copy, so editing the source without running the update command is not proof that a new conversation will use those files. Keep the repository at its registered location or deliberately register its new location.

For an extracted release bundle, place this plugin directory under `plugins/showai` inside a local marketplace root with a `.agents/plugins/marketplace.json` entry pointing to `./plugins/showai`. Register that root with `codex plugin marketplace add /absolute/path/to/marketplace`, then install with `codex plugin add showai@MARKETPLACE_NAME`. Replace the bundle and repeat the official add command to refresh it. Source-repository users should prefer the verified npm commands above.

## Claude Code

For Claude Code, the repository also exposes `.claude-plugin/marketplace.json`. From the repository's parent directory:

```sh
claude plugin marketplace add ./ShowAI
claude plugin install showai@renaissance-mind
```

For development without installing: `claude --plugin-dir ./plugins/showai` from the ShowAI repository. Installing the plugin does not publish a site or change MCP server configuration.

The skill invokes `node /absolute/path/to/plugin/scripts/cli.mjs`. Every page operation explicitly selects a project, and every revision requires a previously read content hash. Optional MCP connections are configured per project; see `skills/show-document/references/agent-usage.md` in a built bundle or `docs/agent-usage.md` in the source repository.

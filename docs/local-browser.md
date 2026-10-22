# Local browser edition

**Language:** English | [简体中文](i18n/local-browser.zh-CN.md) · [Documentation](README.md)

The browser edition runs a local service and opens the complete workbench in a browser. Content stays in the local library; local editing needs no Cloud account. It shares the desktop/CLI document format, version references and concurrency checks.

## Launch a distribution

Extract the `ShowAI-browser-VERSION-PLATFORM-ARCH` package into a persistent directory.

| Platform | Workbench                       | CLI          |
| -------- | ------------------------------- | ------------ |
| macOS    | `start.command` or `./start.sh` | `./showai`   |
| Linux    | `./start.sh`                    | `./showai`   |
| Windows  | `start.cmd`                     | `showai.cmd` |

The distribution includes Node, workbench assets, CLI, reader and a native component compiler. Keep the launcher terminal open. If automatic opening fails, use its printed URL. `Ctrl+C` stops the service; closing the browser tab closes the interface.

The service binds to `127.0.0.1`, generates a launch credential and checks host/origin. Use ShowAI Server for shared remote storage. Desktop and browser can access the same selected library; stale writes trigger conflict handling.

## Choose the content directory

The default is `~/.showai`. The browser workbench stores its library preference in `~/.showai-browser/settings.json`, separately from desktop window preferences. A launch argument or environment variable fixes the directory for that process:

```sh
./start.sh --home /absolute/path/to/library
```

```bat
start.cmd --home C:\Users\you\ShowAI
```

`SHOWAI_HOME` is also supported. Startup registers that library's `agent-runtime.json`; launch again after moving the distribution so paths are refreshed.

## Files, saving and agent use

Import, export, source-directory selection and publication preparation use the workbench's local file picker. It supports path entry, folder navigation, shortcuts, folder creation and overwrite confirmation. Exports write to the selected disk destination. Revealing a file opens the OS file manager; separate Page windows open browser tabs. Copying launch configuration depends on browser clipboard permission. **Settings → Plugins** installs the Codex and Claude Code plugins through their command-line tools, as the desktop app does, and copies a per-agent configuration (`claude mcp add`, Codex `config.toml`, `mcpServers` JSON).

Auto-save and `Cmd/Ctrl+S` remain available. Unsaved, saving or conflicting state triggers the browser's leave prompt. Check **Saved** before leaving: a browser cannot wait for asynchronous saving in the same way as Electron, and a crash can lose pending edits.

The included CLI can run while the workbench is closed:

```sh
./showai projects list --json
./showai runtime register --json
```

Use `showai.cmd` on Windows. Settings supplies the executable, arguments and `SHOWAI_HOME`. See [Agent integration](agent-integration.md) for MCP and [Built-in agent](agent-host.md) for execution settings.

## Build from source

```sh
npm ci
npm run build:browser
npm run browser
```

To choose a service port or avoid automatic opening:

```sh
node dist-runtime/scripts/cli.mjs serve --port 5175 --no-open
```

Omitting the port selects an available one. `--json` prints machine-readable launch information.

For hot reload, use `npm run dev:browser` with explicit `--port`, `--home` and `--no-open` when appropriate. The default port is 5173 and default development library is `.showai-dev/library`. `npm run dev` runs only the standalone canvas. See [Contributing](../CONTRIBUTING.md) for isolated instances.

## Package a distribution

```sh
npm run package:browser
npm run test:browser:package
```

Build on each target platform because compiler dependencies contain native binaries. Packaging downloads the official standalone Node version for the build platform/architecture and verifies SHA-256. `SHOWAI_PACKAGE_NODE_VERSION` can select a compatible version; the default is the build machine's Node version. Linux needs the official Node system libraries and uses `xdg-open` on graphical desktops.

The **Browser distributions** GitHub workflow builds platform packages and runs server/package checks. Available downloads and platform verification depend on the actual workflow/release results.

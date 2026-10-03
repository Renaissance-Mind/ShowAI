# Use ShowAI from an Agent

ShowAI stores projects and pages on disk and uses one Node.js implementation for the desktop application, command line, and optional MCP server. The CLI is built at `dist-agent/cli.mjs`. The plugin carries the same CLI at `scripts/cli.mjs` plus the offline reader. A Python Agent can invoke this executable with `subprocess`, or use an MCP client; it does not need a separate rendering engine.

Run `npm run build` once from the source repository. Node.js 22.12 or later is required for standalone CLI/plugin use. The examples below use the repository entry point; replace it with the installed plugin's absolute `scripts/cli.mjs` path when using a plugin. They do not rely on an unpublished npm package.

## Use the installed desktop runtime

The desktop application's Settings → Connect Agent panel provides a JSON launch configuration with `command`, `args`, and `env`. It points at the installed ShowAI executable, its bundled CLI and the currently selected data directory. Use that configuration when Node.js is not separately installed. The application window can be closed while these CLI commands run; no background Core service is required.

For the default macOS installation, the equivalent command is:

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/ShowAI.app/Contents/MacOS/ShowAI" \
  "/Applications/ShowAI.app/Contents/Resources/plugin/scripts/cli.mjs" \
  projects list --json
```

When the desktop application uses a non-default content directory, also pass `--home` or the `SHOWAI_HOME` value from its copied configuration. On Windows, use the executable and resource paths copied from Settings; the installation directory is user-selectable.

## Plugin installation

The source repository includes Codex and Claude Code marketplace manifests. For Codex, run `npm run plugin:install` once and `npm run plugin:update` after changes. Both build only the reader, CLI and plugin, use the official Codex installation commands, compare the installed bundle byte-for-byte and confirm it is enabled. The receipt is saved to `artifacts/codex-plugin-install.json`; start a new conversation after success. See [the plugin README](../plugins/showai/README.md) for details and extracted release bundles. For Claude Code, build first with `npm run build`.

From the repository root, Claude Code supports:

```sh
claude plugin marketplace add ./
claude plugin install showai@renaissance-mind
```

The plugin is a skill plus the compiled CLI and reader. It does not publish a site, register a global active project or silently connect an MCP server. Its standalone `node` commands require Node.js 22.12+; the desktop launch configuration above uses ShowAI's bundled runtime instead.

## Storage and session binding

By default, authoring files live in `~/.showai`. Set `SHOWAI_HOME` or add `--home /absolute/path` to use a different root. The desktop application and every Agent must use the same root to share edits. There is no global active project. A page operation must name its project.

```sh
node dist-agent/cli.mjs projects list --json
node dist-agent/cli.mjs projects create --name "A research topic" --harness codex --session ACTUAL_SESSION_ID --json
node dist-agent/cli.mjs projects bind PROJECT_ID --harness claude-code --session ACTUAL_SESSION_ID --json
node dist-agent/cli.mjs pages list --project PROJECT_ID --json
```

Use the real conversation/session identifier provided by the harness. If unavailable, omit binding and preserve the returned project id in the conversation. A new unrelated conversation gets its own project. Reusing an existing project requires an explicit selection. Repeating project creation for an already bound harness/session returns its existing project.

`--json` returns `{ "ok": true, "data": ... }`; failures return `{ "ok": false, "error": { "code", "message", "currentHash"? } }`. The process exits nonzero on failure (`3` for conflicts). Without `--json`, listings print ids and titles, while record commands print readable JSON.

## Templates and components

```sh
node dist-agent/cli.mjs catalog list --project PROJECT_ID --json
node dist-agent/cli.mjs catalog list --kind template --query report --json
node dist-agent/cli.mjs catalog describe COMPONENT_ID --kind component --project PROJECT_ID --json
node dist-agent/cli.mjs catalog describe TEMPLATE_ID --kind template --project PROJECT_ID --json
node dist-agent/cli.mjs template apply TEMPLATE_ID --project PROJECT_ID --title "My report" --json
node dist-agent/cli.mjs template save --project PROJECT_ID --page PAGE_ID --name "My report layout" --description "Evidence followed by comparison" --json
node dist-agent/cli.mjs catalog import --input /absolute/path/component-package --project PROJECT_ID --json
```

Applying a template creates a new page. Importing without `--project` makes a component available from the global catalog; a project-specific import remains in that project. Component versions are immutable. The Agent can inspect component purpose, schema, presets, and version without receiving the entire compiled browser bundle.

## Safe revisions and user edits

```sh
node dist-agent/cli.mjs pages create --project PROJECT_ID --input report.showai.json --json
node dist-agent/cli.mjs pages read PAGE_ID --project PROJECT_ID --json
node dist-agent/cli.mjs pages diff PAGE_ID --project PROJECT_ID --since PREVIOUS_HASH --json
node dist-agent/cli.mjs pages apply PAGE_ID --project PROJECT_ID --input operations.json --base-hash CURRENT_HASH --json
node dist-agent/cli.mjs pages save PAGE_ID --project PROJECT_ID --input revised.showai.json --base-hash CURRENT_HASH --json
```

Read checkpoints preserve a baseline for later comparison. `diff` describes changes since a previous read; it does not change the page or accept user edits. Saving or applying operations requires the current content hash. If the page changed in the desktop application or another Agent, ShowAI returns `CONFLICT` with the current hash and leaves the file intact. Read again, inspect the difference and merge the content before retrying.

`pages create/save --input` accepts a version 1 ShowAI artifact or its document object. `pages apply --input` accepts an operation array or `{ "operations": [...] }`. An input path of `-` reads JSON from stdin. For example:

```json
[
  { "type": "page.set", "fields": { "title": "Revised findings" } },
  {
    "type": "block.text.set",
    "blockId": "STABLE_BLOCK_ID",
    "text": "An updated finding."
  }
]
```

Other operations are `block.insert`, `block.remove`, `block.replace`, `block.move`, and `block.attrs.set`. Use the stable ids returned by `pages read`, and preserve them when saving. In insert/move operations, omitted `afterId` appends; `afterId: null` places the block first. Root-level placement uses omitted/null `parentId`.

## Delivery

```sh
node dist-agent/cli.mjs export --project PROJECT_ID --page PAGE_ID --format html --out /absolute/path/report.html --json
node dist-agent/cli.mjs export --project PROJECT_ID --page PAGE_ID --format inline --out /absolute/path/report-inline.html --json
node dist-agent/cli.mjs export --project PROJECT_ID --format site --out /absolute/path/site --json
```

HTML and inline exports also save a `.showai.json` source next to the output. Site export creates an `index.html`, page files, shared reader assets, a `sources/` directory and `showai-site.json`. Multiple pages have relative navigation, so the directory can be hosted under a subpath. No hosting account is required to build these outputs; sharing through a public URL requires uploading the site directory to a static host.

Offline exports require embedded raster images and contain the exact installed custom-component versions used by the pages. They do not fetch a component CDN at runtime. By default existing output files are not replaced; use `--overwrite` deliberately. Site overwrite accepts only an empty directory or an existing ShowAI site for the same project. A whole-project export skips archived pages and removes page/source files recorded by the previous site manifest when they are no longer included. An explicit `--page` export may still select an archived page.

Exports may be saved outside authoring data or inside `projects/PROJECT_ID/exports/` in the selected content directory. Project source files, snapshots and another project's export subtree are protected, including when a symbolic link points to them. The output source JSON carries the custom component runtimes; importing that JSON into another project installs those exact versions without executing their code.

Inline is a UTF-8 fragment for a host-supported visualization surface, with a 1 MB payload limit. Large media or many custom runtimes may require standalone HTML. A browser test wrapper must declare UTF-8; the fragment intentionally has no document-level head or charset. In this Codex desktop conversation, the visualize capability can render it; a terminal or generic MCP client does not acquire HTML rendering merely by connecting a tool. Preview the actual delivered artifact in its target surface and exercise a relevant interaction.

## Optional MCP

The plugin normally uses the bundled CLI through its skill. MCP is optional and is a subprocess started by the Agent host, not a system daemon. Bind the connection to one existing project when configuring it:

```sh
codex mcp add showai-PROJECT_ID -- node /absolute/path/ShowAI/dist-agent/cli.mjs mcp --project PROJECT_ID
claude mcp add --transport stdio --scope local showai-PROJECT_ID -- node /absolute/path/ShowAI/dist-agent/cli.mjs mcp --project PROJECT_ID
```

For an isolated home, append `--home /absolute/path/store`. Use a different server name or update configuration deliberately when switching projects. The plugin does not auto-register a global server because an installed plugin is shared across conversations.

The server exposes project context, page list/create/read/save/apply/diff/export, component/template lookup, component import and template operations. Project selection is fixed at startup; tool arguments cannot silently switch to another project. All standard I/O output is MCP JSON-RPC, and diagnostic logs go to stderr. This server provides tools, not a claim of universal MCP Apps UI support.

A general MCP client uses:

```json
{
  "mcpServers": {
    "showai-research": {
      "command": "node",
      "args": [
        "/absolute/path/ShowAI/dist-agent/cli.mjs",
        "mcp",
        "--project",
        "PROJECT_ID"
      ]
    }
  }
}
```

A Python Agent can also call the CLI directly:

```python
import json
import subprocess

result = subprocess.run(
    ["node", "/absolute/path/ShowAI/dist-agent/cli.mjs", "pages", "read",
     "PAGE_ID", "--project", "PROJECT_ID", "--json"],
    check=True, capture_output=True, text=True,
)
page = json.loads(result.stdout)["data"]
```

The Agent owns planning and data gathering; ShowAI owns page validation, rendering and delivery. Static exported pages do not make model calls. Agent-triggering buttons would require an explicitly implemented host bridge or backend.

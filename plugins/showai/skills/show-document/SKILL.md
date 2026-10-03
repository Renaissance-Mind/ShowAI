---
name: show-document
description: Create, inspect, revise, and share interactive ShowAI pages using reusable components and templates. Use when the user asks for ShowAI, an interactive report, a visual explanation, or a small content site.
---

Use ShowAI's bundled command to work with real project files shared with the desktop application. Read [Agent usage](references/agent-usage.md) for exact commands and [Artifact format](references/artifact-format.md) for document structure. The plugin root is two levels above this skill directory. Invoke:

```sh
node /absolute/path/to/showai/scripts/cli.mjs --help
```

The command requires Node.js 22.12 or later. This package includes a compiled viewer and CLI; it does not require an API key. Component compilation uses the bundled platform-specific compiler. Check `assets/build.json` for its operating system and architecture.

## Bind the current conversation

Every page command needs an explicit project id. When this conversation already has a ShowAI project, reuse its id. When the user asks to continue another project, list projects and bind only the selected project. Otherwise create a project with a descriptive name and the host's actual conversation/session id:

```sh
node /absolute/path/to/showai/scripts/cli.mjs projects create --name "Research topic" --harness codex --session "ACTUAL_SESSION_ID" --json
```

Use `--harness claude-code` or the actual host name on other Agents. If no session id is available, create a project without binding and keep the returned project id in the conversation; do not invent or borrow a session id. Never guess the current project from the most recently edited project, working directory, or global active state. To explicitly reuse a selected project, use `projects bind PROJECT --harness HOST --session ACTUAL_SESSION_ID`.

Default storage is `~/.showai`; `--home` or `SHOWAI_HOME` changes it. Use the same home as the desktop application so user and Agent edits reach the same files. Save documents in this store, then export the deliverable separately. Do not keep the only editable source in a temporary visualization directory.

## Create and revise

1. Search `catalog list --project PROJECT --json`, then describe relevant components or templates. Built-in data and component descriptions specify supported inputs and intended use.
2. Apply a template with `template apply ID --project PROJECT --json`, or create a page with `pages create --project PROJECT --input FILE --json`.
3. Before any follow-up edit, `pages read PAGE --project PROJECT --json`. Keep the returned `hash` and stable block ids. Compare to the hash from the previous turn using `pages diff PAGE --project PROJECT --since HASH --json` so manual user edits are visible.
4. Preserve the user's changes. Use targeted operations when possible: `pages apply PAGE --project PROJECT --input OPERATIONS.json --base-hash HASH --json`. A full `pages save` also requires `--base-hash`.
5. On `CONFLICT`, read again, inspect what changed, and merge deliberately. Never retry with a newer hash while blindly keeping an old full-document replacement.

Keep page content and data factual. Use the user's data or verified sources, label assumptions and scenarios, and omit unknown measurements. Include only sections and controls useful to the subject. A page delivers content; project management remains in the authoring application.

## Deliver

```sh
node /absolute/path/to/showai/scripts/cli.mjs export --project PROJECT --page PAGE --format html --out /absolute/path/report.html --json
node /absolute/path/to/showai/scripts/cli.mjs export --project PROJECT --page PAGE --format inline --out /absolute/path/report-inline.html --json
node /absolute/path/to/showai/scripts/cli.mjs export --project PROJECT --format site --out /absolute/path/site --json
```

Images must be embedded for offline export. Exported HTML contains the reader, page data, and the exact installed component versions used by the page. Site export includes relative navigation and shared reader assets. Output is not automatically published.

For a host with an inline visualization surface, read that host's visualization instructions, export `inline` into a permitted durable path, preview it, and send the host-supported reference. The Codex visualization reference is host-specific and is not a general MCP protocol. For other hosts, return the HTML artifact or use the available browser preview. Never claim a terminal can render HTML inline or that generating a file installed a plugin.

The MCP server is optional. It starts through the same CLI with `mcp --project PROJECT` and is deliberately bound to that one project. See [Agent usage](references/agent-usage.md) for explicit per-project setup. The plugin does not silently register a global active project or change user configuration.

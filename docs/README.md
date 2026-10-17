# ShowAI documentation

**Language:** English | [简体中文](i18n/index.zh-CN.md)

ShowAI turns shared work with agents into readable, interactive and editable Pages. Start with the quick start or choose the connection you use below.

These guides follow the current `main` source: **application 0.9.0, local plugin 0.16.1, artifact format v3** (updated 2026-10-16). Application/runtime, local plugin and deployed services update independently. Check `runtime info --json`, plugin installation receipts and the actual service for installed capabilities. Release downloads may lag the source; see [GitHub Releases](https://github.com/Renaissance-Mind/ShowAI/releases).

## Start here

| Guide                                     | Contents                                          |
| ----------------------------------------- | ------------------------------------------------- |
| [Quick start](quick-start.md)             | Launch, create, save and share                    |
| [ChatGPT on the web](chatgpt.md)          | Account, MCP, consent and updates                 |
| [Use with Codex](codex.md)                | Local plugin, runtime and saved-page workflow     |
| [Local browser edition](local-browser.md) | Launchers, file operations and packaging          |
| [Page and Board](page-surface.md)         | Nested containers, drawing, reading and shortcuts |
| [Built-in agent](agent-host.md)           | Local/API, Cloud and paired Mac execution         |

## Components and templates

| Guide                                            | Contents                                                |
| ------------------------------------------------ | ------------------------------------------------------- |
| [Components and templates](catalog-lifecycle.md) | Scopes, immutable versions, composition and publication |
| [Skills and workflows](skills.md)                | Eight Skills and task routing                           |
| [Template folders](template-bundles.md)          | Metadata, four stages and component libraries           |
| [Component parameters](component-parameters.md)  | Generated references, omission and relation checks      |
| [G2 data charts](g2-components.md)               | 43 charts, datasets and field mapping                   |
| [Mind maps](mindmap.md)                          | Layouts, shortcuts, data and export                     |
| [Diagram components](diagram-components.md)      | Archify, Diagram Design and Fireworks                   |
| [Application icons](icons.md)                    | Icon browser, shared exports and SVG                    |

## Storage and services

| Guide                                                | Contents                                               |
| ---------------------------------------------------- | ------------------------------------------------------ |
| [Content library](versioned-library.md)              | SQLite current state, drafts, recovery and maintenance |
| [ShowAI Cloud](cloud.md)                             | Accounts, linked servers and model sources             |
| [Project synchronization](project-sync.md)           | Self-hosting, permissions, transfer and conflicts      |
| [Server operations](server-operations.md)            | Consistent backup, restore, migration and budgets      |
| [Cloudflare MCP deployment](cloud-mcp-deployment.md) | Gateway, shared guides and acceptance                  |

## Integration and development

| Guide                                     | Contents                                               |
| ----------------------------------------- | ------------------------------------------------------ |
| [Agent integration](agent-integration.md) | stdio/HTTP, OAuth, tools and presentation              |
| [CLI reference](agent-usage.md)           | Scripts, diagnostics, service setup and administration |
| [Artifact format v3](artifact-format.md)  | Nodes, geometry, components, export and limits         |
| [Brand assets](branding.md)               | Logo source, variants and generation                   |

[Plugin installation](../plugins/showai/README.md) covers Codex and Claude Code. [Contributing](../CONTRIBUTING.md) explains isolated development and relevant tests; participation follows the [Code of Conduct](../CODE_OF_CONDUCT.md).

## Runtime-provided reference

After building, inspect the current operation guide from the repository:

```sh
node dist-runtime/scripts/cli.mjs guide --json
node dist-runtime/scripts/cli.mjs runtime info --json
```

For installed applications, use the actual command from Settings or the selected library's `agent-runtime.json`. Agent document operations use MCP. Hosted ChatGPT connections obtain shared workflow text through `guide`; no local Skill installation is required.

Report documentation problems through [GitHub Issues](https://github.com/Renaissance-Mind/ShowAI/issues), including the affected language, guide and runtime version. When contributing, update the paired English/Chinese guide and both indexes.

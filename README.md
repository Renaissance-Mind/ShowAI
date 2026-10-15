![ShowAI — An interface between humans and agents.](docs/showai-banner.svg)

[![ShowAI website](https://img.shields.io/badge/Website-ShowAI-120A8F?style=flat&labelColor=30343B)](https://showai.renaissancemind.ai/)
[![License: MIT](https://img.shields.io/badge/License-MIT-287A55?style=flat&labelColor=30343B)](LICENSE)
[![MCP compatible](https://img.shields.io/badge/MCP-compatible-167C80?style=flat&labelColor=30343B)](#cli-and-mcp)
[![ChatGPT web integration](https://img.shields.io/badge/ChatGPT-Web-187765?style=flat&labelColor=30343B)](#chatgpt-on-the-web)
[![Codex plugin](https://img.shields.io/badge/Codex-Plugin-475569?style=flat&labelColor=30343B)](docs/codex.md)
[![Claude Code plugin](https://img.shields.io/badge/Claude_Code-Plugin-B96547?style=flat&labelColor=30343B)](plugins/showai/README.md)

**Language:** English | [简体中文](docs/i18n/README.zh-CN.md)

[Documentation](docs/README.md) · [Quick start](docs/quick-start.md) · [Use with Codex](docs/codex.md) (Chinese)

**Your agent answers with a UI, not a wall of text.**

Chat is a poor interface for real work. Agents can analyze a market, plan a project or explain a system, but the result arrives as a long block of text you can only reply to. ShowAI lets the agent answer with an interactive page instead, one that you and the agent keep working on together.

https://github.com/user-attachments/assets/ecdccdec-1def-45a9-811f-121a7d07b906

<sub>Ask a question in any agent conversation and get back an interface you can use, edit together and share. Try the examples at [showai.renaissancemind.ai](https://showai.renaissancemind.ai/).</sub>

![For Agents: A way to communicate and collaborate with humans, turning information and analysis into content people can understand, use, and give feedback on. — For Humans: A way to participate in AI work, bringing your understanding and judgment into shared creation through reading, exploration, and editing.](docs/showai-audience.svg)

### ✨ Highlights

- **Intelligent UI**: The agent composes each page for the task at hand from components such as charts, flow diagrams, mind maps, tables, sliders, and interactive models. Every component has a description, a parameter schema, and examples, so the agent picks the right form instead of writing throwaway HTML.

  When a task needs something new, the agent writes a React component that stays reusable for later pages.

- **Human–agent collaboration**: The page is not a one-off output. Inspect charts, adjust parameters, and edit content directly, in the conversation or in the ShowAI App, a workbench that feels like a note-taking app. The agent picks up from your changes instead of starting over.

  Drafts and current content merge structurally. Concurrent conflicts keep both inputs for you to review.

- **Works with ChatGPT and local agents**: In ChatGPT, pages render right inside the conversation through a custom MCP connector. Claude Code and Codex connect through the ShowAI plugin, and other MCP clients can use the stdio entry point.

  The ShowAI App also has a built-in agent that can use your ChatGPT plan, OpenRouter, DeepSeek, and other model providers.

- **One workspace across devices**: Sign in to ShowAI Cloud or your own ShowAI Server to sync projects, components, and assets between devices. Keep editing offline; changes catch up when you reconnect, and conflicting edits from different devices are both preserved.

  Invite others to a project as editors or viewers.

When the work is done, export it as standalone HTML that works offline, or as a static site. See [Share pages and sites](#-share-pages-and-sites).

> **Language note:** The workbench interface is available in English and Simplified Chinese. It follows your system language by default (Chinese system languages use Simplified Chinese, all others use English); change it in **Settings → Appearance → Language**. Exported pages show their reader controls in the language used when they were exported. Documents marked *(Chinese)* below are available in Chinese only; the remaining reference documents are in English.

## 🧩 Design

![ShowAI design: dynamically added components, content and templates, co-creation in agent context and the ShowAI App, then use and delivery](docs/showai-design-logic.svg)

1. **Components: express information as needed.** Text, images, tables, charts, flow diagrams, and sliders provide different forms of expression and interaction. Agents can choose existing components or create and add new ones for a task, such as controls that let readers adjust parameters and inspect calculated results.

2. **Content and templates: organize content and reuse structure.** Components combine into content people can read and use. A [Page](docs/page-surface.md) arranges articles and reports in sequence; a Board uses spatial layout to organize relationships and proposals. Save common structures and component combinations as templates: fill an existing template with new material, or extract a template from finished content for future use. See [Components and templates](docs/catalog-lifecycle.md).

3. **Co-creation: participate in chat and the app.** In agent conversations that support page display, content appears directly in the chat. People can inspect charts and use controls, then ask the agent to continue analyzing and editing through follow-up messages.

   The ShowAI App provides a workbench similar to a note-taking app for managing projects and pages, editing content directly, and reusing components. Discussion can happen in the agent's context while content continues to be organized and refined in the app.

4. **Use and delivery: make content usable and shareable.** Standalone HTML preserves reading and interaction without requiring ShowAI. A static Site organizes multiple pages for sharing through a URL. Partial exports can share a component or region; source JSON supports importing and further editing so the results can keep being used.

## 💡 Use cases

- **Research and analysis**: Organize questions, sources, evidence, and comparisons to reach a judgment on one page.
- **Teaching and explanation**: Combine diagrams, collapsible content, and parameter experiments to support gradual understanding.
- **Data exploration**: Keep charts, raw data, and analysis together for inspection and verification.
- **Collaborative planning**: Refine proposals between humans and agents, integrating feedback into the shared page.
- **Knowledge sharing**: Turn shared work into pages or sites that others can read and explore.

## 🚀 Getting started

Running from source requires **Node.js 22.12+** and npm.

### Local browser workbench

```sh
git clone https://github.com/Renaissance-Mind/ShowAI.git
cd ShowAI
npm ci
npm run build:browser
npm run browser
```

The browser opens the local workbench after startup. Keep the terminal running while you use it; press `Ctrl+C` to stop the service.

### Desktop workbench

After installing dependencies in the repository directory, build and launch the Electron app:

```sh
npm run build
npm run desktop
```

### Create your first content

1. Create a project, then a Page or Board.
2. Type `/` to insert components, or choose an existing template.
3. Edit the content, or create it together with a connected agent.
4. Export HTML or a static site when finished.

The default content library is `~/.showai`; you can change it in settings. The desktop app, browser workbench, and CLI read and write the same projects when they point to the same library.

The local browser edition supports macOS, Linux, and Windows. It can also be packaged with a bundled Node runtime. See [Local browser edition](docs/local-browser.md) *(Chinese)* for the launcher and platform requirements.

## 🤖 Connect an agent

ShowAI connects to ChatGPT on the web through the hosted MCP server, and to Codex and Claude Code through local plugins. Ask for what you want to create:

> Create a model research report in the current project, with sources, a comparison table, and conclusions on the same page.

> Revise this explanation by adding an interactive model with adjustable parameters so readers can observe the effects of changes.

> Turn this page into a reusable template and create an example that uses it.

### ChatGPT on the web

Connect the hosted ShowAI MCP server to create, save, and edit interactive pages in regular chats on [chatgpt.com](https://chatgpt.com). After account setup, everyday web use needs no local ShowAI process or separate Skill installation. Your ChatGPT account must support custom MCP servers, subject to workspace permissions.

1. **Get a ShowAI Cloud account.** Registration is currently controlled: ask a project administrator for an invitation link or the Cloud operator for a registration key ([account access inquiries](https://github.com/Renaissance-Mind/ShowAI/issues)). Complete initial registration in the ShowAI desktop or local browser workbench: with a key, open **Settings → Servers and sync → Server accounts → Add server account**, enter `https://showai.renaissancemind.ai/cloud`, and register with an account name and a password of at least 12 characters. With an invitation, paste it into **Project sync → Join shared project**, then register in the invitation card; no registration key is needed. Existing Cloud accounts can skip this step.
2. **Add the connection.** Open [ChatGPT Plugins](https://chatgpt.com/plugins), select **+ → Add custom MCP server**, and use the settings below. Create it as a plugin, then install it.
3. **Sign in and authorize.** Use your ShowAI account and password, or GitHub/Google already linked to that account. Social sign-in opens another tab; copy its 8-character completion code back into the original ShowAI authorization tab and continue. To create projects, authorize **all projects this account can access now and in the future** and check that consent includes **project creation**, reading, and editing. A single-project grant covers only that existing project. Member permissions still apply.
4. **Try it.** Start a new chat, type `@`, select **ShowAI**, and ask: “List my ShowAI projects. Then create a project called My Interactive Notes, make an interactive page about opportunity cost, save it, confirm sync status, and present it here.” Review write actions when ChatGPT prompts you. You can later find and edit the saved page by project and page name.

| Setting | Value |
| --- | --- |
| Name | `ShowAI` |
| Server URL | `https://agent.showai.renaissancemind.ai/mcp` |
| Authentication | **OAuth or no authentication** |
| OAuth client registration, if prompted | **Dynamic Client Registration (DCR)** |
| Client ID / Client Secret | Leave blank; DCR registers automatically |

The MCP URL ends in `/mcp`; the workbench account/sync URL ends in `/cloud`. Public components, templates, and temporary rendering work without sign-in. Private project access requires a ShowAI account. Projects stored only on your computer must be synced to the same Cloud account first. Workflow guides are served through MCP from the shared Skill sources.

**Updates:** ShowAI maintainers deploy server and guide updates; later calls use the deployed version. Start a new chat to load current guidance. When tools, parameters, authentication metadata, or preview resources change, open **ChatGPT Plugins → your ShowAI connection → Refresh**, then start a new chat and select `@ShowAI` again. Expired sign-in or a broader project scope requires reauthorization. No ZIP download is needed. Share this guide and the MCP URL with others; each person adds and authorizes their own connection.

See the [complete ChatGPT web guide](https://showai.renaissancemind.ai/en/doc/chatgpt) for account setup, the completion-code flow, permission troubleshooting, and preview retry steps. ChatGPT UI labels and availability can vary; see [OpenAI's custom MCP instructions](https://developers.openai.com/api/docs/guides/custom-mcp-server#how-to-use).

### Install a local plugin

**Codex**: Requires the [Codex CLI](https://github.com/openai/codex) on your `PATH`. Run in the repository directory:

```sh
npm run plugin:install
```

Use `npm run plugin:update` to refresh an installed plugin after pulling new changes. Start the ShowAI app once (or run `npm run runtime:register`, below) so the plugin can find the runtime in your content library.

**Claude Code**: Run in the repository directory:

```sh
claude plugin marketplace add ./
claude plugin install showai@renaissance-mind
```

The plugin includes seven skills:

| Skill | Purpose |
| --- | --- |
| `use-showai` | Basic usage, runtime connection, finding and reading content |
| `plan-presentation` | Plan reader goals, evidence and a layered understanding path |
| `design-presentation` | Design visual expression, layout, interactions and static alternatives |
| `review-presentation` | Evaluate clarity and reader tasks, revise and verify |
| `show-document` | Create, edit, display, and export pages; apply existing templates |
| `create-component` | Create or adapt reusable React components |
| `create-template` | Create and edit templates, or extract them from existing pages |

The plugin supplies authoring workflows and reference material. The ShowAI app or a standalone runtime package supplies the executable runtime. Desktop users can find startup configuration in Settings → Connect Agent (「设置 → 连接 Agent」). For a standalone runtime built from source, run:

```sh
npm run runtime:register
```

See [Plugin documentation](plugins/showai/README.md) for installation and connection steps.

### CLI and MCP

The CLI exits after each command and can be used while the workbench is closed. After building, run these commands in the repository directory:

```sh
# List existing projects
node dist-runtime/scripts/cli.mjs projects list --json

# Find available components
node dist-runtime/scripts/cli.mjs catalog list \
  --kind component --query 图表 --limit 5 --json

# Read the page authoring guide
node dist-runtime/scripts/cli.mjs guide authoring --json
```

Other agent clients can connect through the optional stdio MCP entry point. See [Agent guide](docs/agent-usage.md) for the complete commands, editing protocol, and configuration.

## 📦 Share pages and sites

| Export format | Use |
| --- | --- |
| **Standalone HTML** | Sharing, offline reading, and archiving |
| **inline fragment** | Display in agent conversations that support HTML |
| **Static site** | Multiple-page navigation and static hosting |

Standalone HTML supports offline interactions such as switching charts, collapsing content, and calculating local parameters. External source links require a network connection. Images must be embedded for offline exports.

Replace `PROJECT_ID` and `PAGE_ID` below with actual IDs to export a page:

```sh
node dist-runtime/scripts/cli.mjs export \
  --project PROJECT_ID \
  --page PAGE_ID \
  --format html \
  --out ./report.html \
  --json
```

Export the entire project as a static site:

```sh
node dist-runtime/scripts/cli.mjs export \
  --project PROJECT_ID \
  --format site \
  --out ./site \
  --json
```

Use `--blocks ID,ID` to export selected components or regions. HTML and inline exports also save a `.showai.json` source file for importing and further editing.

The static site directory can be deployed to your own server or a hosting service. See [Agent guide](docs/agent-usage.md) for export formats and options.

## 🔒 Content and synchronization

Project content is stored locally in transactional SQLite and can be backed up or migrated. Saves update current content and check resource tokens to prevent overwriting concurrent edits. Local drafts and conflict recovery preserve unfinished work.

For collaboration across devices or with other people, connect to a self-hosted ShowAI Server to synchronize current pages, component dependencies and assets by project. Administrator, editor and viewer roles control access. HTML previews and exports are generated on demand.

See [Content library](docs/versioned-library.md) and [Project server and synchronization](docs/project-sync.md) *(Chinese)*.

## 📚 Documentation

| Document | Contents |
| --- | --- |
| [ChatGPT web guide](https://showai.renaissancemind.ai/en/doc/chatgpt) | Account setup, MCP connection, OAuth, and updates |
| [Quick start](docs/quick-start.md) *(Chinese)* | First project, first page, and agent connection |
| [Page and Board](docs/page-surface.md) *(Chinese)* | Pages, boards, and interaction |
| [Agent guide](docs/agent-usage.md) | CLI, MCP, authoring, and export |
| [Agent integration](docs/agent-integration.md) | MCP entry points and host configuration |
| [Plugin documentation](plugins/showai/README.md) | Skill responsibilities and installation |
| [Use with Codex](docs/codex.md) *(Chinese)* | Codex plugin setup and document workflow |
| [Data charts](docs/g2-components.md) *(Chinese)* | Chart types, data interfaces, and settings |
| [Components and templates](docs/catalog-lifecycle.md) *(Chinese)* | Catalogs, versions, dependencies, and reuse |
| [Content library](docs/versioned-library.md) | Storage, drafts, merging, and recovery |
| [Local browser edition](docs/local-browser.md) *(Chinese)* | Launcher, packaging, and platform requirements |
| [Project server and synchronization](docs/project-sync.md) *(Chinese)* | Server deployment, project permissions, and synchronization |
| [Server operations](docs/server-operations.md) | Backup, restore, and migration |
| [Page data format](docs/artifact-format.md) | Page structure and data conventions |

## 🛠️ Development and contributions

ShowAI uses React, TypeScript, Electron, and Vite. Rich text editing uses Tiptap, flow diagrams use React Flow, and data visualization uses G2.

Start the full desktop workbench with hot reload:

```sh
npm run dev:open
```

Check the current development service:

```sh
npm run dev:status
```

Use `npm run dev:browser` for browser development. The default development library is `.showai-dev/library`; startup arguments can select another directory. See [CONTRIBUTING.md](CONTRIBUTING.md) for isolated development instances, ports, and test notes.

Before submitting changes, run:

```sh
npx playwright install chromium
npm run check
npm test
npm run build
```

Install Chromium once for the browser-based tests. On Windows, directory-link tests use junctions; file-symlink tests report a skip when Developer Mode or symlink privileges are unavailable. Other path and integrity checks still run.

For desktop behavior, run `npm run test:desktop`. For Page and Board interactions, run `npm run test:containers` and `npm run test:containers:desktop`.

Use [Issues](https://github.com/Renaissance-Mind/ShowAI/issues) to report problems or suggest use cases, or contribute code, components, templates, and documentation through a pull request. Include your environment, reproduction steps, and expected and actual results when reporting a problem.

## License

ShowAI is licensed under the [MIT License](LICENSE).

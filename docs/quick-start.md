# Quick start

**Language:** English | [简体中文](i18n/quick-start.zh-CN.md) · [Documentation](README.md)

ShowAI is the evolving interface between humans and agents: your agent's answers become interfaces — interactive, archived, and evolving as you use them.

ShowAI works inside the agent you already use: the plugin lets your agent build interfaces, and the ShowAI app keeps, opens and edits them. This guide goes from download to your first interface, then shows how to keep working on it and share it.

## Before you start

- A Mac with Apple silicon running macOS 13 or later.
- **Claude Code** or **Codex**, installed and signed in. ShowAI installs its plugin through the agent's command-line tool, so that tool must be available; for Codex, ShowAI also finds the CLI bundled with the Codex app.
- No agent yet? Use the [built-in agent](#without-claude-code-or-codex) with a model API key.
- On Windows or Linux, [run the browser edition from source](#run-from-source).

## 1. Install ShowAI

1. Download the DMG from the [latest release](https://github.com/Renaissance-Mind/ShowAI/releases/latest).
2. Open it and drag **ShowAI** into **Applications**, then open ShowAI.
3. Current builds are not yet notarized by Apple, so macOS may block the first launch. If it does, open **System Settings → Privacy & Security** and choose **Open Anyway** ([Apple's instructions](https://support.apple.com/en-us/102445)). Each release's notes say whether this is still needed.

## 2. Connect your agent

1. In ShowAI, open the plugin panel: the welcome screen shows it on first launch, and it is always available under **Settings → Plugins**.
2. ShowAI checks for Claude Code and Codex. Click **Install plugin** next to the agent you use and wait for **Installed and enabled**.
3. Reload the agent: restart the Claude Code session, or refresh plugins or restart Codex. A conversation that was already open keeps its old tool list, so start a new one.

To confirm the connection, **Settings → Plugins** shows a test prompt, _Use ShowAI to list my projects_. Send it in the new conversation; when the agent reaches ShowAI, the status next to that agent changes from **Waiting for the first call** to **First call received**.

The app supplies both the plugin and the runtime it talks to, so you need neither the source code nor a separate Node.js installation. The plugin connects to the app's current content library; click **Update and enable** after switching libraries or moving the app.

## 3. Ask for your first interface

Paste this into a new conversation:

> Use ShowAI to build a mortgage calculator: price, down payment, rate and term are adjustable; show the monthly payment and total interest.

The agent saves the interface as a page in ShowAI and presents it: inline in agents that can display it, otherwise as an HTML file you can open. In the app it appears under **Recent**.

Two more to try:

> Use ShowAI to compare two foldable phones on portability, battery, camera and price, and let me adjust the weights.

> Use ShowAI to explain attention step by step, with a diagram whose parameters I can adjust to see the weights change.

## If the agent can't find ShowAI

| What you see                                        | What to do                                                                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The plugin panel says the agent was not found       | Install Claude Code or Codex, make sure its command-line tool runs in a terminal (`claude --version` or `codex --version`), then click **Check again**.          |
| **Installed, disabled**                             | Click **Update and enable**.                                                                                                                                     |
| ShowAI is enabled from another source               | Disable that plugin in the agent, then click **Check again** and install the app version.                                                                        |
| The agent answers in text and never mentions ShowAI | The conversation started before the plugin loaded. Restart the agent and open a new conversation; asking explicitly with "Use ShowAI to …" helps.                |
| The agent reports that it cannot connect to ShowAI  | If you moved the app or switched libraries, open **Settings → Plugins** and click **Update and enable**, then restart the agent.                                 |
| A page was saved but you can't find it in the app   | The app and the plugin are using different content libraries. Compare **Settings → General → Content library** with the library shown in **Settings → Plugins**. |

Still stuck? [Open an issue](https://github.com/Renaissance-Mind/ShowAI/issues) with your agent and its version, the ShowAI version from **Settings → About**, and what the agent said.

## 4. Keep working on it

The interface is a page you own. Open it from **Recent** and edit it directly: type text, or type `/` to insert tables, charts, images and other components. The save indicator shows **Saved** when your changes are stored.

Then ask the agent to continue:

> Add a chart of the remaining balance by year. Keep the values I changed.

The agent reads the current page, including your edits, before it changes anything. If you and the agent change the page at the same time, the later save stops and both versions are kept for comparison, so neither overwrites the other.

When an interface needs something the existing components can't express, the agent can build a new component for it. A page that works well can become a template for the next one. See [Components and templates](catalog-lifecycle.md).

## 5. Share it

| Format          | Use                                                      |
| --------------- | -------------------------------------------------------- |
| Standalone HTML | Send a single page, read it offline or archive it        |
| Inline fragment | Present a page or selection in a compatible conversation |
| Static site     | Publish several pages with navigation                    |
| ShowAI JSON     | Import and continue editing                              |

Choose **Export page** in the page's menu, or ask the agent. Standalone HTML opens in any browser without ShowAI and keeps interactions such as charts, collapsible sections and local calculations. External links still need a network, and images must be embedded for fully offline reading. HTML exports also write a `.showai.json` source so the page can be imported and edited later.

## Without Claude Code or Codex

**Built-in agent.** Open **Settings → Agent**, add a model source with an API key (or use your local Codex or Claude Code sign-in, or ShowAI Cloud), then click the **AI** button in the top bar, or select text or open a block menu and choose **Ask AI**. See [Built-in agent](agent-host.md).

**Other agents.** DeepSeek Harness and Kimi are in preview, ChatGPT on the web is invite only, and other MCP clients can be configured manually. See [Supported agents](../README.md#-supported-agents).

**On your own.** The workbench works without any agent: choose **New project**, add a **Page** for ordered reading or a **Board** for a spatial workspace, and type `/` to insert components. See [Page and Board](page-surface.md).

## Run from source

The browser edition runs on macOS, Linux and Windows. It needs Git, **Node.js 22.12+** and npm.

```sh
git clone https://github.com/Renaissance-Mind/ShowAI.git
cd ShowAI
npm ci
npm run build:browser
npm run browser
```

Keep the terminal running and open the printed local URL if the browser does not open automatically; press `Ctrl+C` to stop. To build and launch the desktop app instead:

```sh
npm run build
npm run desktop
```

To connect an agent to a source build, install the plugin from the checkout as described in the [plugin documentation](../plugins/showai/README.md). See [Local browser edition](local-browser.md) for launchers and packaging.

## Where your content lives

Pages are stored in a local content library, `~/.showai` by default. Choose another in **Settings → General → Content library**. The app, the plugin and the CLI see the same projects only when they use the same library.

ShowAI saves automatically and keeps drafts and conflict copies, so unfinished work is not lost. If a save fails, resolve the message before closing the page. See [Content library](versioned-library.md). To work across devices or with other people, connect [ShowAI Cloud](cloud.md) or a [self-hosted server](project-sync.md).

Continue with the [documentation index](README.md).

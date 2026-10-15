# Quick start

**Language:** English | [简体中文](i18n/quick-start.zh-CN.md) · [Documentation](README.md)

ShowAI combines text, charts and interactive components in an editable Page. Work directly in the desktop or local browser workbench, or connect an agent to create and revise the same content.

## Run ShowAI

Source builds require Git, **Node.js 22.12+** and npm. The standalone content server requires Node.js 24.

```sh
git clone https://github.com/Renaissance-Mind/ShowAI.git
cd ShowAI
npm ci
npm run build:browser
npm run browser
```

Keep the terminal running. Open the printed local URL if the browser does not open automatically; press `Ctrl+C` to stop the service. To build and launch Electron from the same checkout:

```sh
npm run build
npm run desktop
```

If you already have a browser distribution, use its included launcher. See [Local browser edition](local-browser.md). The source version in `package.json` and the version of an available release artifact can differ; check [GitHub Releases](https://github.com/Renaissance-Mind/ShowAI/releases) for published downloads.

## Create a project and Page

1. Choose **New project**, then name it.
2. Create a **Page** for ordered reading or a **Board** for a spatial workspace.
3. Type `/` to find and insert text, images, tables, charts and other components. You can also start from a template.
4. Check that the save indicator says **Saved**. `Cmd+S` on macOS or `Ctrl+S` on Windows/Linux saves explicitly.

Pages and Boards can nest. An article can include an analysis Board, and a Board can contain a readable Page. See [Page and Board](page-surface.md).

For a research note, start with the question, findings and source links. Compare methods in a table, show verified measurements in a chart, and use diagrams for relationships. Replace example data with your own evidence. Templates supply organization; they still need the task's actual material.

## Work with an agent

[ChatGPT web](chatgpt.md) connects to the hosted MCP endpoint. [Codex](codex.md) and Claude Code use the local plugin and registered runtime. The [built-in agent](agent-host.md) edits from the workbench and can use local execution, Cloud execution or a paired Mac where available.

Try a request such as:

> In my Literature Review project, create an attention-mechanism note from the supplied sources. Include the research question, evidence, a method comparison and unresolved points. Save it and present it here.

Continue with the same project and Page:

> Add an adjustable example to the methods section. Keep my revised conclusion and source links.

Use project/Page IDs when names are ambiguous. An agent reads current content and saves with its hash and revision. If a concurrent write conflicts, compare the edits before retrying.

## Share the result

| Format          | Use                                                      |
| --------------- | -------------------------------------------------------- |
| Standalone HTML | Share a single page, read offline or archive             |
| Inline fragment | Present a page or selection in a compatible conversation |
| Static site     | Navigate multiple pages through static hosting           |
| ShowAI JSON     | Import and continue editing                              |

The page's export menu creates standalone HTML. Use bundled components and embedded images for offline delivery. Links and online services still need a network. HTML/inline exports also write a `.showai.json` companion. Static sites are intended for HTTP hosting.

## Storage and recovery

The default library is `~/.showai`. Choose another in **Settings → General → Content library**, or specify `--home` for a CLI process. Workbench and agent connections see the same projects only when they use the same library.

Check save failures and retained drafts before closing. Current content is stored in transactional SQLite; original migration material and recovery data are retained. See [Content library](versioned-library.md). Cross-device editing uses [ShowAI Cloud](cloud.md) or a [self-hosted server](project-sync.md).

Continue with the [documentation index](README.md) for components, authoring and operations.

---
name: showai-contributing
description: Change the ShowAI source repository and prepare a pull request. Use when adding or changing a built-in component (src/components/blocks, resources/catalog), a built-in template or the system-presentation baseline (resources/templates), an app feature or fix, public documentation, or the Agent plugin and its Skills (plugins/showai), and when choosing which tests to run for such a change. Covers requests such as 内置组件、内置模板、改 ShowAI 源码、提 PR、跑哪些测试. Creating components or templates inside a user's content library through MCP is the plugin's create-component and create-template Skills instead.
---

# Contributing to ShowAI

The guides in this repository hold the steps; this Skill tells you which one to read and what a finished change includes. Paths are relative to the repository root.

## 1. Classify the change

Read `CONTRIBUTING.md` first, then the guide for the change:

| Change                                                       | Read                                           |
| ------------------------------------------------------------ | ---------------------------------------------- |
| Built-in component: new kind, data contract, renderer        | `docs/contributing-components.md`              |
| Built-in template, or the `system-presentation` baseline     | `docs/contributing-templates.md`               |
| Feature or fix in the workbench, CLI, MCP, sync or desktop   | "Features and fixes" in `CONTRIBUTING.md`      |
| Public Markdown, README, indexes                             | "Documentation" in `CONTRIBUTING.md`           |
| `plugins/showai/` Skills, host adapters, CLI or MCP protocol | "Agent plugin and Skills" in `CONTRIBUTING.md` |
| Running instances, `dev:status`, which tests need a build    | `docs/development.md`                          |

A change often spans several rows. A new built-in component also updates the plugin's `reuse-selection.md`, and a CLI or MCP change also updates the Skills, `src/agent/guides.ts` and `docs/agent-usage.md` with its Chinese counterpart. Read every guide that applies before editing.

## 2. Check before editing

- Ask whether the change belongs in this repository. A component or template for one topic belongs in a content library; the guides say when a built-in is justified. For a new built-in or a new entry point, check whether the issue already agreed on the scope, and say so to the user if it did not.
- Look for the existing implementation first: the registry and catalog for components, existing menus and commands for features, and existing tests next to the code you change. Extend them instead of adding a parallel path.
- Note the user's uncommitted changes (`git status`) and leave them out of your edits and commits.

## 3. Make the change completely

Follow the numbered steps of the guide; each step names the file. Points that are easy to miss:

- New public `.md` files need an exact allowlist line in `.gitignore`, and every English guide changes together with its `docs/i18n/*.zh-CN.md` counterpart and both indexes.
- Interface strings go into `src/i18n/messages/` in both `zh-CN` and `en`.
- Built-in kinds need a literal `registerBlock` call and a `validateWidgetData` branch in `src/portable/validation.mjs`; no test catches a missing branch.
- Edit Skills only in `plugins/showai/`, then run `npm run package:plugin` and commit the regenerated host copies.
- Saved pages and libraries written by earlier versions must keep loading after your change.

## 4. Verify

Run the fast tests for the area while working, for example `npx vitest run src/components/builtin-registration.test.ts` for components or `npx vitest run src/core/builtin-template-files.test.ts` for templates; they name each missing registration. Tests that render or export pages need `npm run build:portable` first, and CLI or MCP integration tests need `npm run build`. Before finishing, run:

```sh
npm run check
npm run build
npm test
```

Then run the area commands and manual checks the guide lists. Use a development instance with its own port and library, never the user's everyday library (`~/.showai`). If a check cannot run in your environment, such as the Electron smoke tests or a plugin host refresh, say which one and why instead of reporting it as passed.

## 5. Report and hand off

Commit with a Conventional Commits message that covers only your files. Summarize for the user, and in the pull request description: what changed, which guide steps applied, the commands you ran with their results, the manual checks and platform, and anything left unverified. Fill in the matching checklist in `.github/PULL_REQUEST_TEMPLATE.md`.

# Contributing to ShowAI

**Language:** English | [简体中文](docs/i18n/CONTRIBUTING.zh-CN.md)

ShowAI accepts built-in components, built-in templates, features and fixes, documentation, and changes to the Agent plugin and its Skills. This guide shows where each kind of change lives, what it must update, and how to verify it. Product and integration guides are indexed in [Documentation](docs/README.md).

For a new built-in component or template, or a feature that adds an entry point or changes a data format, open a [feature request](https://github.com/Renaissance-Mind/ShowAI/issues/new/choose) first so the scope can be agreed before you build it.

## Setup

You need Node.js 22.12 or newer with npm, and Git. Install Chromium for the browser-based tests with `npx playwright install chromium`. To test the Agent plugin you also need [Codex](https://github.com/openai/codex) or Claude Code.

```sh
git clone https://github.com/Renaissance-Mind/ShowAI.git
cd ShowAI
npm ci
npm run dev:open
```

This starts a desktop development instance with hot reload on port 5173 with the content library `.showai-dev/library`. [Development and testing](docs/development.md) explains how to keep parallel instances apart, how to read `npm run dev:status`, and what each test suite needs.

## What you are changing

| Change                                           | Guide                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| A built-in component                             | [Contributing a built-in component](docs/contributing-components.md) |
| A built-in template or the presentation baseline | [Contributing a built-in template](docs/contributing-templates.md)   |
| A feature or fix in the app                      | [Features and fixes](#features-and-fixes)                            |
| Documentation                                    | [Documentation](#documentation)                                      |
| The Agent plugin, its Skills or the CLI protocol | [Agent plugin and Skills](#agent-plugin-and-skills)                  |

Components and templates that serve one topic or one user usually belong in a content library rather than in this repository. The two guides explain when a built-in is the better choice.

## Checks for every pull request

```sh
npm run check   # TypeScript and the component SDK boundary
npm run build   # full build; CLI and MCP integration tests use its output
npm test        # Vitest unit and integration tests
```

Each kind of change adds its own checks, listed in its guide or section. Continuous integration runs the same commands on Linux and Windows.

## Features and fixes

Extend what already exists before adding to it. A new action on an object goes into the existing selection, context or hover menu of that object, with object-specific actions after the general ones; add a new toolbar, gear button or floating control only when no existing entry point fits, and explain why in the pull request. The same action reached from different menus uses one command and one source of state.

Every interface string goes into a message namespace in `src/i18n/messages/` with both `zh-CN` and `en`. `src/i18n/i18n.test.ts` rejects hard-coded Chinese, missing keys and mismatched placeholders, and `src/i18n/glossary.ts` fixes the names of core terms such as page, board and block.

Saved pages, content libraries and exported pages outlive the code that wrote them. A change to a data format, a CLI command or an MCP tool must keep reading what earlier versions wrote; check the existing callers and describe the compatibility in the pull request. Handle errors where they enter the program (I/O, processes, user input) and surface the cause; do not swallow a failure and report success.

Run the tests of the area you changed:

| Area                                | Command                                                      |
| ----------------------------------- | ------------------------------------------------------------ |
| Desktop behavior (Electron)         | `npm run test:desktop`                                       |
| Page and Board interaction          | `npm run test:containers`, `npm run test:containers:desktop` |
| Component browser                   | `npm run test:component-gallery`                             |
| Development launcher and hot reload | `npm run test:dev`, `npm run test:dev -- desktop`            |
| Browser edition server              | `npm run test:browser`                                       |
| Sync server                         | `npm run test:server`                                        |
| HTTP MCP gateway                    | `npm run test:cloud-mcp`                                     |

Add tests that use a real temporary library and real component compilation rather than mocks. Check interface changes in a development instance as well: browser results do not prove desktop behavior, so a change that touches Electron needs the desktop instance. Check the narrow window, the dark theme, keyboard use and the reading view of anything you change on screen.

## Documentation

Markdown files are ignored by default. A new public `.md` file needs its exact path in the allowlist in `.gitignore`; otherwise Git silently leaves it out. Every English guide has a Simplified Chinese counterpart: `README.md` ↔ `docs/i18n/README.zh-CN.md`, `CONTRIBUTING.md` ↔ `docs/i18n/CONTRIBUTING.zh-CN.md`, `docs/TOPIC.md` ↔ `docs/i18n/TOPIC.zh-CN.md`. Change both together, list a new guide in both indexes (`docs/README.md` and `docs/i18n/index.zh-CN.md`), and keep the language switches and relative links valid.

README, the quick start, the banners, the app's welcome copy and the homepage share one tagline, one-liner and sample prompt, defined in `scripts/release-entry.mjs`. Run `npm run release:check` after changing them. The app's built-in documentation in `resources/docs` is a copy of the pages published at showai.renaissancemind.ai/doc; change the website's documentation and run `npm run docs:sync -- --site <website>/site` instead of editing the copy.

Check every documented command against the code that implements it, and say which version a statement describes: source, installed app or plugin, deployed service or published release. Keep internal plans, credentials, machine-specific paths, test logs and acceptance evidence out of public documentation.

## Agent plugin and Skills

The plugin source is `plugins/showai/`: Skills, host adapters and the MCP launcher. `npm run package:plugin` (also part of `npm run build`) checks each Skill's frontmatter and relative links, then regenerates the host packages `plugins/showai-codex`, `plugins/showai-claude` and `plugins-kimi/showai`. Edit only `plugins/showai/` and commit the regenerated copies with it. After adding or removing a Skill file, also run `node scripts/mcp-skill-source.mjs` so the hosted MCP gateway serves the same files.

A Skill's `description` decides when an Agent loads it, and its body is read by an Agent that has no other context. After changing either, give a fresh Agent session the installed Skills and a few realistic requests, and check which Skill it picks and whether it can tell what to do next from the text alone. Describe these requests and the result in the pull request.

When you change a CLI command, its arguments or its output, or an MCP tool, update the Skills, `src/agent/guides.ts` and the documents that describe it (usually `docs/agent-usage.md` or `docs/agent-integration.md` and their Chinese counterparts) in the same pull request. `src/agent/doc-examples.test.ts` checks the tool calls quoted in Skills and guides against the current tool schemas. Agents keep calling tools in the shape they learned, so when an MCP tool's name or arguments change, record the change in `src/agent/tool-changes.ts` and translate the earlier shape in `src/agent/mcp-compat.ts`.

To try the plugin locally, `npm run plugin:update -- --json` installs the packaged plugin into Codex and verifies the installed files, and `npm run plugin:claude -- --port <port> --json` binds Claude Code in this checkout to a running development instance. Installing the files and the host loading them are separate steps: confirm the new Skills and tools in a new conversation.

## Working with an AI agent

The repository includes a `showai-contributing` Skill in `.claude/skills/` and `.agents/skills/`. Claude Code and Codex load it automatically when they work in this checkout, and it leads the Agent through the same guides and checks.

## Pull requests

- Keep each pull request focused on one change. Describe what changed and why, and what you verified: commands, desktop or browser, platform, and the manual checks from the relevant guide.
- Use [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(editor): ...`, `fix(sync): ...`, `docs: ...`.
- Fill in the checklist of the pull request template for the kind of change you made.

## Reporting issues

Use [GitHub Issues](https://github.com/Renaissance-Mind/ShowAI/issues). For bugs, include your platform, ShowAI version or commit, whether you used the desktop or browser workbench, reproduction steps, and the expected and actual results.

## Code of conduct

Participation in this project is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

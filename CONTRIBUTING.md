# Contributing to ShowAI

Thanks for helping improve ShowAI. This guide covers the local development setup, tests, and what we expect in a pull request. 中文读者可参考 [中文 README](docs/i18n/README.zh-CN.md) 的「开发与贡献」一节；本文的命令同样适用。

## Prerequisites

- Node.js 22.12 or newer and npm
- Git
- Chromium for Playwright-based tests: `npx playwright install chromium`
- Optional: the [Codex CLI](https://github.com/openai/codex) or Claude Code, to test the agent plugin

```sh
git clone https://github.com/Renaissance-Mind/ShowAI.git
cd ShowAI
npm ci
```

## Development instances

The development launcher builds the app with hot reload. Frontend changes update in place; backend, desktop main process, preload, built-in component sources, and CLI changes are rebuilt and the local service restarts after a save.

| Command                                       | What it does                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `npm run dev:open`                            | Start (or reuse) a desktop development instance in the background and open it     |
| `npm run dev:open -- browser`                 | Same, using the browser workbench                                                 |
| `npm run dev:status`                          | Show the running instance: mode, port, content library, source branch and process |
| `npm run dev:desktop` / `npm run dev:browser` | Run the desktop or browser instance in the foreground                             |
| `npm run dev`                                 | Standalone single-page canvas only; not a substitute for the full workbench       |

By default an instance uses port 5173 and the content library `.showai-dev/library`. Give each parallel instance its own port, content library, and (for desktop) settings directory so they cannot write to each other's data:

```sh
mkdir -p /tmp/showai-dev-a/profile
SHOWAI_USER_DATA=/tmp/showai-dev-a/profile \
  npm run dev:open -- --port 5180 --home /tmp/showai-dev-a/library
npm run dev:status -- --port 5180 --home /tmp/showai-dev-a/library
```

- `--home` must be an absolute path. An instance keeps its port and library for its whole lifetime.
- `SHOWAI_USER_DATA` isolates the desktop app's settings and agent state.
- `--no-focus` (with `dev:open`) or `--no-open` (with `dev:desktop` / `dev:browser`) starts the instance without bringing a window forward, which is useful for automated runs.
- Build output and launcher records for each instance live in `.showai-dev/<mode>-<port>/`. Do not move or delete them while the instance is running.
- Do not point a development instance at your everyday content library (`~/.showai`) when testing changes that write data.

The development badge in the bottom-right corner shows the source directory, branch, and commit the instance was started from.

## Tests

Run these before opening a pull request:

```sh
npm run check   # TypeScript
npm run build   # full build; the CLI/MCP integration tests use its output
npm test        # Vitest unit and integration tests
```

Depending on what you changed, also run:

| Area                                | Command                                                      |
| ----------------------------------- | ------------------------------------------------------------ |
| Desktop behavior (Electron)         | `npm run test:desktop`                                       |
| Page and Board interaction          | `npm run test:containers`, `npm run test:containers:desktop` |
| Development launcher and hot reload | `npm run test:dev`, `npm run test:dev -- desktop`            |
| Browser edition server              | `npm run test:browser`                                       |
| Sync server                         | `npm run test:server`                                        |

Tests use real file I/O and real component compilation; please avoid adding mocks where a real temporary library works. On Windows, file-symlink tests are skipped when Developer Mode or symlink privileges are unavailable.

Browser results do not prove desktop behavior. If a change touches Electron-specific behavior, verify it in the desktop instance as well.

## Agent plugin and skills

The Codex / Claude Code plugin lives in `plugins/showai/`. After changing a skill, reference document, or the plugin manifest:

```sh
npm run plugin:update   # reinstall into Codex and verify the installed files
```

Then start a new agent conversation to load the updated skills. If you change a CLI command, its arguments, or its output, check whether the skills that describe it need the same update.

## Pull requests

- Keep each pull request focused on one change and describe what you verified (commands, desktop or browser, platform).
- Use [Conventional Commits](https://www.conventionalcommits.org/) style messages, for example `feat(editor): ...`, `fix(sync): ...`, `docs: ...`.
- When adding a feature, extend existing entry points and menus (selection, context, and hover menus) before adding a new toolbar or button.
- Handle errors at real boundaries (I/O, processes, user input) and surface the cause; do not swallow failures.
- Markdown files are ignored by default. To add a new public `.md` file, add its exact path to the allowlist in `.gitignore`.
- User-facing documents are maintained in English and Simplified Chinese. Update `README.md` and `docs/i18n/README.zh-CN.md` together.

## Reporting issues

Use [GitHub Issues](https://github.com/Renaissance-Mind/ShowAI/issues). For bugs, include your platform, ShowAI version or commit, whether you used the desktop or browser workbench, reproduction steps, and the expected and actual results.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

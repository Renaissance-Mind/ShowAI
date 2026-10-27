# Contributing to ShowAI

**Language:** English | [简体中文](docs/i18n/CONTRIBUTING.zh-CN.md)

This guide covers development setup, relevant verification and pull requests. Product and integration guides are indexed in [Documentation](docs/README.md).

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
mkdir -p /absolute/showai-dev-a/profile /absolute/showai-dev-a/tmp
SHOWAI_USER_DATA=/absolute/showai-dev-a/profile TMPDIR=/absolute/showai-dev-a/tmp \
  npm run dev:open -- --port 5180 --home /absolute/showai-dev-a/library --no-focus
npm run dev:status -- --port 5180 --home /absolute/showai-dev-a/library
```

- `--home` must be an absolute path. An instance keeps its port and library for its whole lifetime.
- `SHOWAI_USER_DATA` isolates the desktop app's settings and agent state.
- `--no-focus` (with `dev:open`) or `--no-open` (with `dev:desktop` / `dev:browser`) starts the instance without bringing a window forward, which is useful for automated runs.
- Build output and launcher records for each instance live in `.showai-dev/<mode>-<port>/`. Do not move or delete them while the instance is running.
- Do not point a development instance at your everyday content library (`~/.showai`) when testing changes that write data.

### Reading `dev:status`

`dev:status` only reads; it never changes a running instance. It exits with 0 when the instance on the port is ready and 1 otherwise, and its JSON explains why:

- `reason` (present whenever `ready` is false): a `code` and `message`. `NOT_LISTENING` (with `lastSession`, the last launcher record of that port), `NO_RESPONSE`, `PORT_IN_USE`, `OTHER_SOURCE_ROOT`, `PREPARING`, `STARTING_BACKEND`, `BUILDING`, `RESTARTING`, `WAITING_FOR_APP_QUIT` (the desktop app is closing its windows; once it agreed to quit, `step` names the service it is stopping), `BACKEND_EXITED` (with `exitCode`), `BACKEND_NOT_READY`, `BUILD_FAILED` (with `error`) or `STOPPING`. `phase` repeats the code, or is `RUNNING`.
- `pendingRestart`: the backend is ready but still serves the code it started with (`startedCommit`) because a restart is waiting. `code` is `BUILDING`, `WAITING_FOR_PAGES`, `RESTART_PAUSED` (open pages did not confirm saving; `blockers` name each page or shared dataset, the window URL and why), `QUIT_BLOCKED` (the desktop app refused to quit; `windows` and `record`) or `BUILD_FAILED`. `since` is when the first unapplied change was requested. Fix the cause, then click the development badge to retry.
- `stopBlocked`: Ctrl+C did not stop the instance because the desktop app refused to quit.
- `quitRecord` (desktop): the path of the app's `quit-blocked.json`, which lists every window that refused to close and why.
- `instances`: every running app that serves the requested library. They come from the presence records apps write to `<home>/local/instances/<pid>.json`, from development launchers of this checkout (`.showai-dev/*/session.json`), and from processes whose command matches the launch in `<home>/agent-runtime.json` (apps built before presence records existed). Each entry has `pid`, `mode`, `channel`, `appVersion` or `sourceCommit`, `evidence`, `self` (the service on this port) and `registered`.
- `registered`: what `<home>/agent-runtime.json` registers, which is the CLI/MCP launch Agents use, with the `pids` of the apps that match it.
- `warnings`: `MULTIPLE_INSTANCES`, `REGISTERED_ELSEWHERE`, `REGISTERED_NOT_RUNNING`, `REGISTRATION_MISSING`, `REGISTRATION_INVALID`, `HOME_MISMATCH`, `PENDING_RESTART`, `STOP_BLOCKED` and `QUIT_BLOCKED`, each with a `message`.

Stop task-owned processes before deleting temporary libraries/profiles. Retain needed source material and verification evidence; never treat another running instance as a cache.

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
| HTTP MCP gateway                    | `npm run test:cloud-mcp`                                     |

Tests use real file I/O and real component compilation; please avoid adding mocks where a real temporary library works. On Windows, file-symlink tests are skipped when Developer Mode or symlink privileges are unavailable.

Browser results do not prove desktop behavior. If a change touches Electron-specific behavior, verify it in the desktop instance as well.

## Agent plugin and skills

The Codex / Claude Code plugin lives in `plugins/showai/`. After changing a skill, reference document, or the plugin manifest:

```sh
npm run plugin:update   # reinstall into Codex and verify the installed files
```

Check the installer JSON/receipt for success, enabled state, version, installed path, verified files and tree digest. Refresh the host using its supported procedure, then confirm the current tools and Skills in a new conversation. Installation and host refresh are separate checks. If you change a CLI command, its arguments, or its output, check whether the skills that describe it need the same update.

## Pull requests

- Keep each pull request focused on one change and describe what you verified (commands, desktop or browser, platform).
- Use [Conventional Commits](https://www.conventionalcommits.org/) style messages, for example `feat(editor): ...`, `fix(sync): ...`, `docs: ...`.
- When adding a feature, extend existing entry points and menus (selection, context, and hover menus) before adding a new toolbar or button.
- Handle errors at real boundaries (I/O, processes, user input) and surface the cause; do not swallow failures.
- Markdown files are ignored by default. To add a new public `.md` file, add its exact path to the allowlist in `.gitignore`.
- Maintain English and Simplified Chinese together: `README.md` ↔ `docs/i18n/README.zh-CN.md`, `docs/TOPIC.md` ↔ `docs/i18n/TOPIC.zh-CN.md`, and both documentation indexes. Keep language switches and relative links valid.
- README, the quick start, the banners, the app's welcome copy and the homepage share one tagline, one-liner and sample prompt, defined in `scripts/release-entry.mjs`. Run `npm run release:check` after changing them (`npm run release:check -- --online` before a release also checks the published release and homepage), and draft release notes with `npm run release:notes -- --headline "…" --changes changes.json`.
- The app's built-in documentation (`resources/docs`) is a copy of the pages published at showai.renaissancemind.ai/doc. Do not edit it by hand: change the website's documentation, then run `npm run docs:sync -- --site <website>/site`. The website's release refuses to deploy while the two differ.
- Verify documented commands against the owning implementation. Distinguish source versions, installed runtime/plugin versions, deployed service state and published release artifacts.
- Keep internal plans, credentials, machine-specific state, test logs and acceptance evidence outside public documentation.

## Reporting issues

Use [GitHub Issues](https://github.com/Renaissance-Mind/ShowAI/issues). For bugs, include your platform, ShowAI version or commit, whether you used the desktop or browser workbench, reproduction steps, and the expected and actual results.

## Code of conduct

Participation in this project is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

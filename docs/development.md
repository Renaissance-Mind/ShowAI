# Development and testing

**Language:** English | [简体中文](i18n/development.zh-CN.md) · [Documentation](README.md) · [Contributing](../CONTRIBUTING.md)

This guide covers running ShowAI from source, keeping parallel instances apart, and the test suites with what each needs. [Contributing](../CONTRIBUTING.md) says which checks each kind of change requires.

## Development instances

The development launcher builds the app with hot reload. Frontend changes update in place; backend, desktop main process, preload, built-in component sources, and CLI changes are rebuilt and the local service restarts after a save. If an open page has unsaved changes, the restart waits until the page confirms saving.

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

The development badge in the bottom-right corner shows the source directory, branch, and commit the instance was started from.

### Connecting an Agent to an instance

`dev:status` returns a `cli` object with the command, arguments and environment that run the CLI and MCP server of that instance against its library. Use it for scripted checks such as `template context` or `catalog describe`. To connect Claude Code to the instance, run `npm run plugin:claude -- --port <port> [--mode browser] --json` in the checkout; it installs a `showai-dev` plugin bound to that instance into the checkout's `.claude/settings.json`. It needs the instance running and the `claude` CLI. Remove it with `--remove` before deleting the checkout. An MCP session keeps the code it started with, so check runtime or Skill changes in a new session after the instance has rebuilt.

### Reading `dev:status`

`dev:status` only reads; it never changes a running instance. It exits with 0 when the instance on the port is ready and 1 otherwise, and its JSON explains why:

- `reason` (present whenever `ready` is false): a `code` and `message`. `NOT_LISTENING` (with `lastSession`, the last launcher record of that port), `NO_RESPONSE`, `PORT_IN_USE`, `OTHER_SOURCE_ROOT`, `PREPARING`, `STARTING_BACKEND`, `BUILDING`, `RESTARTING`, `WAITING_FOR_APP_QUIT` (the desktop app is closing its windows; once it agreed to quit, `step` names the service it is stopping), `BACKEND_EXITED` (with `exitCode`), `BACKEND_NOT_READY`, `BUILD_FAILED` (with `error`) or `STOPPING`. `phase` repeats the code, or is `RUNNING`.
- `pendingRestart`: the backend is ready but still serves the code it started with (`startedCommit`) because a restart is waiting. `code` is `BUILDING`, `WAITING_FOR_PAGES`, `RESTART_PAUSED` (open pages did not confirm saving; `blockers` name each page or shared dataset, the window URL and why), `QUIT_BLOCKED` (the desktop app refused to quit; `windows` and `record`) or `BUILD_FAILED`. `since` is when the first unapplied change was requested. Fix the cause, then click the development badge to retry.
- `stopBlocked`: Ctrl+C did not stop the instance because the desktop app refused to quit.
- `quitRecord` (desktop): the path of the app's `quit-blocked.json`, which lists every window that refused to close and why.
- `instances`: every running app that serves the requested library. They come from the presence records apps write to `<home>/local/instances/<pid>.json`, from development launchers of this checkout (`.showai-dev/*/session.json`), and from processes whose command matches the launch in `<home>/agent-runtime.json` (apps built before presence records existed). Each entry has `pid`, `mode`, `channel`, `appVersion` or `sourceCommit`, `evidence`, `self` (the service on this port) and `registered`.
- `registered`: what `<home>/agent-runtime.json` registers, which is the CLI/MCP launch Agents use, with the `pids` of the apps that match it.
- `warnings`: `MULTIPLE_INSTANCES`, `REGISTERED_ELSEWHERE`, `REGISTERED_NOT_RUNNING`, `REGISTRATION_MISSING`, `REGISTRATION_INVALID`, `HOME_MISMATCH`, `PENDING_RESTART`, `STOP_BLOCKED` and `QUIT_BLOCKED`, each with a `message`.

Stop the processes you started before deleting temporary libraries or profiles. Keep source material and verification evidence you still need, and never treat another running instance's directory as a cache.

## Tests

### Unit and integration tests

Vitest settings live in the `test` block of `vite.config.ts`. Tests are `src/**/*.test.ts`; they run in Node with `SHOWAI_LANGUAGE=zh-CN` (so they assert the Chinese interface unless a test picks a language) and with the public CDN reader turned off. `npm test` first runs `npm run build:portable` through `pretest`.

| File name               | Meaning                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| `*.test.ts`             | Unit or module test                                                        |
| `*.integration.test.ts` | Runs a real CLI, MCP server, reader or browser against a temporary library |
| `*.concurrent.test.ts`  | Several writers on one library                                             |
| `scripts/*.test.mjs`    | Script tests run with `node --test`, for example `npm run test:sync-docs`  |

Tests use real file I/O and real component compilation. Each test creates its own temporary library with `mkdtemp` under the system temporary directory; please avoid mocks where a real temporary library works. Helpers for common fixtures are in `src/test/`. On Windows, file-symlink tests are skipped when Developer Mode or symlink privileges are unavailable.

Some tests read build output. Run `npm run build` before running them on their own:

| Output                       | Built by                                   | Read by (examples)                                               |
| ---------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `dist-portable`              | `npm run build:portable` (also `pretest`)  | Reader, export and presentation tests                            |
| `dist-agent`, `dist-runtime` | `npm run build` or `npm run build:browser` | CLI, MCP, template workflow and browser server integration tests |
| `dist-cdn`                   | `npm run build:cdn`                        | `src/core/reader-source-worker.test.ts`                          |

To run one file: `npx vitest run src/path/to/file.test.ts`.

### Smoke tests

Smoke tests drive the real desktop app or browser workbench and write their output under `output/playwright/`. Install Chromium once with `npx playwright install chromium`.

| Command                                                      | What it covers                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `npm run test:desktop`                                       | Full build, then Electron smoke tests for windows, library, catalog and directory selection |
| `npm run test:component-gallery`                             | Full build, then the component browser: categories, preview and versions                    |
| `npm run test:containers`, `npm run test:containers:desktop` | Page and Board interaction in the browser and desktop                                       |
| `npm run test:dev`, `npm run test:dev -- desktop`            | Development launcher, hot reload and restart on an isolated copy                            |
| `npm run test:browser`                                       | Browser edition server                                                                      |
| `npm run test:server`                                        | Sync server                                                                                 |
| `npm run test:cloud-mcp`                                     | HTTP MCP gateway                                                                            |

The launcher and container smoke tests delete their isolated source copies and libraries when they finish. Set `SHOWAI_KEEP_TEST_FIXTURES=1` to keep them for debugging, and delete them yourself afterwards.

### Continuous integration

`.github/workflows/check.yml` runs on pushes to `main` and on pull requests:

- **Linux:** `npm run check`, `npm test`, `npm run build`, `npm run test:whiteboard` and `npm audit --audit-level=high`.
- **Windows:** `npm run check`, the Vitest suite, `npm run build`, and the desktop and UI smoke tests.

Other workflows (browser packages, ink portability) run manually before releases.

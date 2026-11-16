# Development and testing

**Language:** English | [简体中文](i18n/development.zh-CN.md) · [Documentation](README.md) · [Contributing](../CONTRIBUTING.md)

This guide covers running ShowAI from source, keeping parallel instances apart, and the test suites with what each needs. [Contributing](../CONTRIBUTING.md) says which checks each kind of change requires.

## Development instances

The development launcher builds the app with hot reload. Frontend changes update in place; backend, desktop main process, preload, built-in component sources, and CLI changes are rebuilt and the local service restarts after a save. If an open page has unsaved changes, the restart waits until the page confirms saving.

| Command                                       | What it does                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `npm run dev:open`                            | Start (or reuse) a hidden desktop development instance                            |
| `npm run dev:open -- browser`                 | Same, using the browser workbench                                                 |
| `npm run dev:status`                          | Show the running instance: mode, port, content library, source branch and process |
| `npm run dev:desktop` / `npm run dev:browser` | Run the launcher in the terminal without opening a UI                             |
| `npm run dev`                                 | Standalone single-page canvas only; not a substitute for the full workbench       |

By default an instance uses port 5173 and the content library `.showai-dev/library`. Give each parallel instance its own port, content library, and (for desktop) settings directory so they cannot write to each other's data:

```sh
mkdir -p /absolute/showai-dev-a/profile /absolute/showai-dev-a/tmp
SHOWAI_USER_DATA=/absolute/showai-dev-a/profile TMPDIR=/absolute/showai-dev-a/tmp \
  npm run dev:open -- --port 5180 --home /absolute/showai-dev-a/library
npm run dev:status -- --port 5180 --home /absolute/showai-dev-a/library
```

- `--home` must be an absolute path. An instance keeps its port and library for its whole lifetime.
- `SHOWAI_USER_DATA` isolates the desktop app's settings and agent state.
- Development instances stay in the background by default. Add `--show` to display the workbench; `dev:open -- --show` reuses the running instance. For desktop, use the same command with `--hide` to hide its windows again. `--url showai://project/…` requires `--show`.
- `--no-focus` (`dev:open`) and `--no-open` (`dev:desktop` / `dev:browser`) remain compatible background options. Removing them no longer opens a window. The native development launcher icon explicitly requests `--show`.
- Every desktop backend restart returns to hidden windows, even after an explicit show. Save refusals pause the restart and remain in status/logs without opening a modal. After changing the launcher itself, save and restart your own launcher process to load the new behavior.
- Build output and launcher records for each instance live in `.showai-dev/<mode>-<port>/`. Do not move or delete them while the instance is running.
- Do not point a development instance at your everyday content library (`~/.showai`) when testing changes that write data.

The development badge in the bottom-right corner shows the source directory, branch, and commit the instance was started from.

### Connecting an Agent to an instance

`dev:status` returns a `cli` object with the command, arguments and environment that run the CLI and MCP server of that instance against its library. Use it for scripted checks such as `template context` or `catalog describe`. To connect Claude Code to the instance, run `npm run plugin:claude -- --port <port> [--mode browser] --json` in the checkout; it installs a `showai-dev` plugin bound to that instance into the checkout's `.claude/settings.json`. It needs the instance running and the `claude` CLI. For Antigravity, run `npm run plugin:antigravity -- --port <port> [--mode browser] --json` (needs the `agy` CLI). Remove it with `--remove` before deleting the checkout. An MCP session keeps the code it started with, so check runtime or Skill changes in a new session after the instance has rebuilt.

### Reading `dev:status`

`dev:status` only reads; it never changes a running instance. It exits with 0 when the instance on the port is ready and 1 otherwise, and its JSON explains why:

- `reason` (present whenever `ready` is false): a `code` and `message`. `NOT_LISTENING` (with `lastSession`, the last launcher record of that port), `NO_RESPONSE`, `PORT_IN_USE`, `OTHER_SOURCE_ROOT`, `PREPARING`, `STARTING_BACKEND`, `BUILDING`, `RESTARTING`, `WAITING_FOR_APP_QUIT` (the desktop app is closing its windows; once it agreed to quit, `step` names the service it is stopping), `BACKEND_EXITED` (with `exitCode`), `BACKEND_NOT_READY`, `BUILD_FAILED` (with `error`) or `STOPPING`. `phase` repeats the code, or is `RUNNING`.
- `pendingRestart`: the backend is ready but still serves the code it started with (`startedCommit`) because a restart is waiting. `code` is `BUILDING`, `WAITING_FOR_PAGES`, `RESTART_PAUSED` (open pages did not confirm saving; `blockers` name each page or shared dataset, the window URL and why), `QUIT_BLOCKED` (the desktop app refused to quit; `windows` and `record`) or `BUILD_FAILED`. `since` is when the first unapplied change was requested. Fix the cause, then click the development badge to retry.
- `presentation` (desktop): `background` plus each workbench window’s `id`, `visible` and `focused` state. Hidden windows still run the real renderer and IPC.
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

### Desktop remote MCP

`npm run test:remote-mcp` builds the App, tests local OAuth and project permissions against a real library, then exercises the settings UI in hidden Electron. Set `SHOWAI_SMOKE_OUTPUT` for retained screenshots/results and `TMPDIR` for temporary libraries. Fixtures and connector processes are cleaned up. Optional `SHOWAI_TEST_CLOUDFLARED` points to a real cloudflared executable for public Quick Tunnel OAuth/MCP checks; `SHOWAI_TEST_DOWNLOAD=1` verifies a real vendor download. These network checks depend on the provider and local network. Direct LAN tests use a real private interface when available and cover key authorization, read-only access, revocation and App restart. Optional `SHOWAI_TEST_TAILSCALE` points to a signed-in Tailscale executable for real Serve/Funnel HTTPS, OAuth and page-save checks, including connector shutdown and preservation of existing routes. These tests require the owner's configured tailnet and use a free HTTPS port; they do not change account permissions. Fixed Cloudflare account authorization requires the owner's setup and is not simulated.

### Smoke tests

Smoke tests drive the real desktop app or browser workbench and write their output under `output/playwright/`. Install Chromium once with `npx playwright-core install chromium`.

Desktop smoke scripts default to `SHOWAI_BACKGROUND=1`; native windows and previews remain hidden while renderer automation and screenshots run. Set `SHOWAI_TEST_SHOW=1` only for a run that needs visible native UI. The development smoke then also verifies explicit `--show`/`--hide` and that the next hot restart hides a previously shown window. Hidden close refusals preserve data and report blockers without displaying the discard dialog. To validate that dialog itself, use a visible run.

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

### UI scenario review

For interactive UI review and reusable functional scenarios, see [UI scenarios](ui-lab.md). `npm run ui:lab` opens no window; `npm run test:ui` captures the real application with headless Chromium or hidden Electron.

### Headless interaction performance

The performance benchmark follows a local working session to locate shared costs in content loading, editing, persistence, rendering and resource lifetime. Its default `all` suite covers workbench readiness, finding and opening another saved page, text replacement, saving and readback, undo/redo, switching with pending edits, an actual external FileStore update, component interaction, scrolling, canvas pan/zoom, and repeated opening and closing of small, representative and large pages. Idle windows record renderer work, backend CPU/RSS, heap/DOM counters and completed host calls. The original open, PageDown, drag and retained-tab cases remain available as `--suite interactions`; `--suite workflow` runs the working-session coverage.

Build with `npm run build`, install full Chromium with `npx playwright-core install chromium`, and create a result directory outside the source library:

```sh
npm run test:interaction-perf -- --source-home /absolute/library --output /absolute/results --suite all --iterations 10
```

The source SQLite database is opened read-only and backed up into a library with a new identity. No separately stored sync/account configuration, runtime registration or browser settings are copied. Fixture discovery and workspace-file preparation finish in a separate process before the measured backend starts. The run verifies its actual library path and uses an independent backend, agent workspace and headless Chromium context. Filesystem caches are not flushed; this is not a cold-disk or native desktop startup measurement.

Use `--list` to inspect saved page metadata, then `--run /absolute/results/run-ID --document PAGE_ID --board BOARD_ID` to reuse an owned snapshot. The default Page is selected from the middle of the available text-size range; the working-session suite additionally selects small and large saved pages. A Page must support scrolling and a Board must contain a visible movable object. Workflow cases repeat up to three times per run; interaction cases use `--iterations`. The snapshot can retain edits or recovery state after failures. Existing result files and evidence are moved under `measurements/` before reuse, so previous runs remain inspectable.

Each measured action asserts its outcome. A failed action is excluded from successful timing distributions and makes the command fail. Saving and dragging also verify real stored content in the copy. `results.json` records the exact pages, input events, host calls, existing application stage timings, CDP script/style/layout totals, long tasks and rAF intervals. Continuous input and typing totals include the input schedule; use their last-input timing, frame intervals and available Event Timing samples to evaluate responsiveness. Idle measurements do not run the benchmark's rAF loop. Core interaction cases have separate diagnostic repetitions that produce CPU profiles, Chromium traces and screenshots without mixing their timing into primary samples.

The report records backend readiness and browser-context readiness separately, plus GPU/build metadata, the harness hash, coverage and exclusions. rAF intervals are not display FPS; content-ready assertions do not prove physical presentation; Event Timing omits continuous events and short observations. Resource snapshots from a few open/close cycles do not prove or disprove a long-term leak. Native Electron IPC/display behavior, real cloud round-trips, hardware pen input and IME composition need their own environments. PageDown does not cover PDF or slide pagination.

Keep results private because they include page titles and may include content in screenshots and failure evidence. The snapshot and measurements are retained; runtime copies and profiles are removed after shutdown. Compare equivalent data and builds on the same machine, without concurrent builds or unrelated load. `npm run test:interaction-perf:unit` checks snapshot isolation, representative-page selection and missing-metric handling.

### Continuous integration

`.github/workflows/check.yml` runs for pushes to `main` and for pull requests, in two jobs. The Linux job runs `npm run check`, `npm run build`, `npm test`, `npm run test:release`, `npm run test:whiteboard` and `npm audit --audit-level=high`. The Windows job runs `npm run check`, `npm run build`, the Vitest suite in one worker, and the desktop and UI smoke tests. A release requires both jobs to pass.

Other workflows run manually: browser packages and ink portability.

### macOS release

A release is cut from a commit on `main` whose Check run has passed; bump `version` in `package.json` in that commit or before it. On an Apple silicon Mac with a Developer ID Application certificate in the keychain, run:

```bash
npm run release:mac -- --headline "Most noticeable change" --changes changes.json --work <folder> --publish
```

`changes.json` lists the `new`, `improved` and `fixed` items for the release notes. The script waits for Check, builds a clean copy of the commit, signs and packages the App, and verifies the signature, the packaged App (`src/desktop/smoke.mjs`), the DMG, the ZIP and the update feed (`latest-mac.yml`). With `--publish` it then tags the commit, uploads the five release files and confirms the uploaded copies. Without `--publish` it stops after verification. It records timings and file digests in `<folder>/release-receipt.json`.

Signing covers Mach-O files only (`src/desktop/sign-mac.cjs`); the bundle's signature seals every other file. Each signature takes a timestamp from Apple, and a request that times out is retried.

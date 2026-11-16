# UI scenarios and interaction checks

[简体中文](i18n/ui-lab.zh-CN.md)

UI Lab opens the real `src/main.tsx → App → Studio` application inside an interactive development console. A scene defines its starting conditions, user actions, assertions and capture points once. The console, headless screenshots and hidden Electron renderer run those same steps.

## Run the Demo

Use Node 24 or newer and the repository dependencies. Build once to supply the application runtime assets. Install the Chromium version matching `playwright-core` if it is missing.

```sh
npm run build
npx playwright-core install chromium
npm run ui:lab -- --port 5859 --state /absolute/path/ui-lab/state --out /absolute/path/ui-lab/results
```

Open the printed `/__ui-lab/` address when you want to use the Demo. Starting the command does not open a browser or application window. The console provides scene selection, theme and viewport controls, reset, single-step execution, complete replay and automatic checks. Single-step execution and replay start from a fresh session. Manual use remains available inside the actual application. External service events can be sent from the console.

The remote connection scenes cover LAN access keys, private Tailscale, Cloudflare Quick Tunnel, a fixed Cloudflare domain, Tailscale Funnel, ChatGPT setup, project permissions, failure recovery and authorization denial. The workbench scenes also create a project through the actual application and verify its files through the real backend.

The service boundary is explicit: remote MCP responses, tunnel startup, OAuth requests and client calls are simulated. UI components, application styles, settings navigation, forms, state transitions and workbench storage use production source. These scenes do not prove that a real Tailscale or Cloudflare route is reachable or that ChatGPT completed an external login. Protocol and network integration checks remain separate, including the tests in `src/remote-mcp/`.

The browser host exposes the desktop renderer capabilities needed by remote settings. Host installation, external Agent scanning, file reveal and new application windows are disabled in scenes. Clipboard writes are recorded without changing the system clipboard; plugin export uses a simulated result. Hidden Electron checks this renderer in a native window; desktop IPC and OS integrations retain their own acceptance tests.

## Capture and verify

```sh
npm run test:ui -- --feature remote-connection --out /absolute/path/ui-lab/results
npm run test:ui -- --url http://127.0.0.1:5859 --feature remote-connection --scene chatgpt --scene permissions --theme dark --width 800 --height 1000 --scale 2 --out /absolute/path/ui-lab/results
npm run test:ui -- --url http://127.0.0.1:5859 --feature workbench --out /absolute/path/ui-lab/results
npm run test:ui -- --renderer electron --feature remote-connection --scene lan --out /absolute/path/ui-lab/results
```

Without `--url`, the test command owns an isolated server and closes it after the run. With `--url`, it leaves the existing Demo running. Repeat `--scene` to select multiple scenes; omit it to run the feature. `--locale en` checks the English application. Supported captures are 760–2560 CSS pixels wide, 560–1800 high, at scale 1 or 2. The default is 1440 × 1000 at scale 2.

Each run writes `report.json` and an offline `index.html`, viewport PNGs, accessibility DOM snapshots, layout measurements and redacted service traces. Failed interactions retain a screenshot and DOM snapshot of the failure. Screenshots wait for assertions, fonts, visible images and two animation frames; capture disables CSS animations and hides the caret. Checks reject a missing application root, viewport overflow, insufficient dialog padding and low contrast on enabled primary buttons where the scene declares those requirements. Renderer exceptions fail the scene; console errors are retained separately for diagnosis. Source commit and working-tree hashes are recorded, and changes during a run invalidate it.

Large trace arguments are recorded as byte counts and SHA-256 hashes so repeated sample imports and datasets do not duplicate their full payloads in every report.

Chromium runs headless. Electron creates a hidden window with an isolated profile, denies new native windows and records every show, focus and activation event. A visibility or focus event fails the run. Neither renderer uses the system mouse or keyboard. Native OS dialogs and foreground window behavior need an isolated display or a separate explicitly authorized acceptance run.

## Review visual changes

```sh
npm run test:ui -- --feature remote-connection --baseline /absolute/path/ui-lab/baselines --update-baseline --out /absolute/path/ui-lab/results
npm run test:ui -- --feature remote-connection --baseline /absolute/path/ui-lab/baselines --out /absolute/path/ui-lab/results
```

Use `--update-baseline` only after reviewing the generated screenshots. Normal runs never replace a baseline. Baselines are separated by platform, architecture, renderer, language, theme, viewport and scale. Missing or resized baselines fail comparison; changed pixels produce a difference PNG. The comparison allows a 0.1% pixel difference with a per-pixel threshold of 0.1. Pin the runtime, fonts and environment for repeated comparison. A run without a baseline can pass interaction and layout assertions while its visual state remains `unreviewed`.

Pass `--baseline DIRECTORY` when starting `ui:lab` to compare against the same reviewed baseline from the console's automatic check button. Reports include actual, baseline and difference images together.

## Add another feature

1. Add a feature module under `src/ui-lab/features/` and register it in `registry.ts`.
2. Describe preparation and steps using `SceneContext.ui`, preferring accessible roles and exact names. Each step must assert its resulting state. Use `inspect()` when the result must be verified in backend state.
3. Use the `none` fixture for real workbench behavior. When external dependencies must be controlled, add a service fixture under `fixtures/` and select it in the server's fixture factory. Keep mock behavior at the service boundary and validate its inputs against application contracts.
4. Declare deterministic external events through `event()` and expose their controls through the feature's `events` list. Add a unit test for state transitions, rejection paths and disposal. Put visible labels in the bilingual messages module.
5. Run the scene manually in the console, automatically in Chromium, then in hidden Electron when renderer behavior matters. Review captures before approving a visual baseline.

The shared target interface and separate DOM/Playwright drivers keep manual replay and automated tests aligned. A `capture` target can add a detail image, while the viewport screenshot always preserves the full application context. Fixture handlers and the console are development-only; the normal production entry excludes the UI Lab bootstrap.

## Ownership and cleanup

Each session has its own library, settings, Agent state and workspace. Reset closes its backend and removes its temporary library/profile/workspace while preserving session metadata and redacted traces. Test renderer profiles are removed after the process closes. Reports and approved baselines remain in `--out` and `--baseline`; keep the runs needed for review and remove old generated results deliberately. UI Lab never changes the stable App or its content library.

Manual sessions are also reclaimed about 30 seconds after their application event connection closes. A connected application stays alive, including one opened separately. This prevents closed tabs and frontend reloads from accumulating backends.

```sh
npm run ui:lab -- status --state /absolute/path/ui-lab/state
npm run ui:lab -- stop --state /absolute/path/ui-lab/state
```

Status verifies the saved process identity against the listening server. Stop requests graceful shutdown and waits for the process to exit and record completion. Server shutdown disposes its sessions and the CLI removes its temporary bundle. Restart the server after changing backend or fixture code. Frontend changes use Vite's development reload. `server.json` records the process and directories; `closed.json` records completed shutdown.

The mechanism itself is checked with `npx vitest run src/ui-lab`. Repository acceptance still includes `npm run check`, `npm run build` and `npm test`.

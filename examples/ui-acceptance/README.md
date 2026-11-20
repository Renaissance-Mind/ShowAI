# Independent UI acceptance template

[简体中文](README.zh-CN.md)

Copy the folder and open [preview.html](preview.html). Numbers identify controls on the current screen. The inspector offers actions, state shortcuts and an expandable flow tree. A node opens a working state where the reviewer can continue. Use `#state=ID` to open a state directly and `?marks=0` to start a visual review with the markers hidden.

Open **Flow canvas** to see every state as a screenshot and follow the actions between them. Use the group buttons to locate a flow or select **Fit** to see all states. Select a screenshot to enter that state. Select **Back** or press Escape to resume the previous screen. Add `?flow=1` to open the canvas directly.

The GitHub repository can include review tools, reusable regression scenarios and generic examples. Keep each task’s review page, action history, screenshots, logs and check reports in its local task directory.

```text
Use the independent UI acceptance template for this change. Use real controls and identify any simulated data or services.
Make the relevant starting, branching, confirmation, cancellation and recovery states directly reachable. Include numbered controls, the current action list and the navigable flow tree.
Verify that the actual controls work after a jump and that manual interactions update the active state, available actions and markers.
Return the tested revision, preview, what to try and the observed result in this chat. For failures, include the expectation, observation and evidence.
```

**Connect a web page.** Declare `window.reviewScenario = { entry, states }` as in [search.html](search.html). Each state has an `id`, `title`, optional `parent`, a `match()` predicate, an optional `enter(ui)` and `actions: [{title, target}]`. A target is a CSS selector or a function returning the control. Markers and inspector buttons activate it. Use `group` and `variants` to organize states. Deeper matches take precedence, with an optional numeric `priority`. Import control lookup helpers from [targets.mjs](targets.mjs). Set `discoverActions: true` to add named visible controls or omit the action list. It also accepts a filter function, a state can override it and `data-review-ignore` excludes a control from discovery.

A direct jump starts a fresh frame and calls `enter`. The app can read its name `ui-review/<id>` and preserve data across frames as needed. Use `dataSource` to describe the data and `preparation` to describe changes made for the jump. For asynchronous screens, use `ui.click(target, label)`, `ui.fill(target, text, label)` and `ui.wait(predicate, label)`. Markers programmatically click controls. Verify pointer, keyboard, drag and native behavior through actual interaction.

**Checks.** Set `checkIsolation: true` only when `ui-review-check/<id>` frames use isolated data and preparation has no persistent side effects. The flow check prepares each state in its own frame and reports controls and failures. Expand a successful row to see its controls. Failed rows open with the reason. Mark conditional actions with `optional: true`. Motion observation records the actual system preference, animation events and visible frame intervals. Exercise the interaction under both normal and reduced motion.

**Package.** Bundle the app into self-contained HTML, then run `node pack.mjs app.html preview.html --source <checkout> --title <title> --data <data-description>`. `--source` defaults to the current directory. The packer checks common HTML and CSS external assets and records branch, revision, working-tree status, build time and content fingerprint. Check dynamic runtime requests separately. Alternatively import `buildReview(appHtml, {title, lang, metadata})` from [pack.mjs](pack.mjs). Native apps use their own screen and test tools.

**Package the flow canvas.** Enable `checkIsolation` and declare `{ from, to, label, kind? }` entries in `reviewScenario.transitions`. Use existing state IDs for both endpoints and the triggering action for the label. The supported kinds are `forward`, `back` and `error`. Add `--flow` and point `--source` at a ShowAI checkout with dependencies installed. Use `--lang` to select the preview language. The packer prepares every state in an isolated frame with headless Chromium and embeds screenshots in the HTML. Code can call `buildFlowReview(appHtml, { source, title, lang, metadata })`.

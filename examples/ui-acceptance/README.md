# Independent UI acceptance template

[简体中文](README.zh-CN.md)

Copy the folder and open [preview.html](preview.html). Numbers identify the controls available on the current screen. The inspector offers the same actions, state shortcuts and an expandable flow tree. A tree node opens a working state where the reviewer can continue interacting. Each task builds and delivers its own HTML file.

```text
Use the independent UI acceptance template for this change. Use real controls and identify any simulated data or services.
Make the relevant starting, branching, confirmation, cancellation and recovery states directly reachable. Include numbered controls, the current action list and the navigable flow tree.
Verify that the actual controls work after a jump and that manual interactions update the active state, available actions and markers.
Return the tested revision, preview, what to try and the observed result in this chat. For failures, include the expectation, observation and evidence.
```

**Connect a web page.** In your app, declare `window.reviewScenario = { entry, states }` as in [search.html](search.html). A state has an `id`, `title`, optional `parent`, a `match()` predicate on the real UI, an optional `enter(ui)` to prepare it, and `actions: [{title, target}]`. A target is a CSS selector or a function returning the current control. Markers and inspector buttons activate that control. Use `group` for tree sections and `variants` for related state shortcuts. Deeper matches take precedence, with an optional numeric `priority` for overlapping states.

A direct jump starts a fresh preview frame and calls `enter`. For asynchronous screens, use `await ui.click(target, label)`, `ui.fill(target, text, label)` or `ui.wait(predicate, label)` for prerequisites. The app can read the frame name `ui-review/<id>` to prepare isolated data. Direct interactions continue in the current frame.

Run `node pack.mjs search.html preview.html` in this folder to rebuild the example. Bundle your own app into a self-contained HTML page and wrap it with the same command, or import `buildReview(appHtml, {title, lang})` from [pack.mjs](pack.mjs). The output embeds the app, markers and flow tree in a single file. Native apps can use their own screen and test tools and deliver evidence for their platform.

import assert from "node:assert/strict";
import { workflowPages } from "./interaction-perf-fixture.mjs";

export async function runWorkflows({
  page,
  measure,
  document,
  board,
  catalog,
  clickPage,
  ready,
  surface,
  resource,
  backend,
  iterations,
  report,
}) {
  const rounds = Math.min(iterations, 3);
  const delay = (ms) => new Promise((done) => setTimeout(done, ms));
  const read = () =>
    page.evaluate(
      ({ projectId, pageId }) =>
        window.showai.invoke("pages:get", { projectId, pageId }),
      document,
    );
  const saved = async () => {
    await page.waitForFunction(() => {
      const status = document.querySelector(".studio-save-state");
      if (status?.classList.contains("is-failed"))
        throw new Error(status.textContent);
      return status?.classList.contains("is-saved");
    });
  };
  report.coverage = {
    workbench: "fresh backend and browser context readiness, navigation search",
    authoring:
      "typing, explicit save/readback, undo/redo, local external update",
    rendering:
      "component state change, scroll, board pan/zoom, retained-view switching",
    lifecycle:
      "small, representative and large saved pages; tab opening/closing; repeated resource snapshots",
    background:
      "idle host calls, renderer task time, backend CPU/RSS; actual local file-store update",
    excluded: [
      "physical display and Electron IPC",
      "cloud round-trip and external AI latency",
      "IME composition and hardware pen",
      "every individual component type",
      "proof of a long-term memory leak",
    ],
  };
  await clickPage(document);
  await resource("document-idle", 8000);
  const materials = workflowPages(catalog, { document, board }).sort(
    (a, b) => a.text - b.text,
  );
  const findTarget =
    materials.find((p) => p.pageId !== document.pageId) ?? document;
  for (let i = 0; i < rounds; i++) {
    await clickPage(document);
    const opened = await measure(
      "quick-jump-open",
      async () => {
        await page.keyboard.press("ControlOrMeta+k");
        await page.locator(".quick-jump input").waitFor();
        return { dialogReady: true };
      },
      i,
    );
    if (opened.failure) break;
    const query = findTarget.title.split(/[：:｜|]/)[0].slice(0, 16);
    await measure(
      "find-content",
      async () => {
        await page
          .locator(".quick-jump input")
          .pressSequentially(query, { delay: 25 });
        await page
          .locator('.quick-jump [role="option"]')
          .filter({ hasText: findTarget.title })
          .first()
          .waitFor();
        return { query, matchedPage: findTarget.pageId, typingDelayMs: 25 };
      },
      i,
    );
    await measure(
      "open-search-result",
      async () => {
        await page
          .locator('.quick-jump [role="option"]')
          .filter({ hasText: findTarget.title })
          .first()
          .click();
        await ready(findTarget);
        return { targetPage: findTarget.pageId };
      },
      i,
    );
  }
  await clickPage(document);

  const changedTitle = `${document.title} · perf`;
  await measure(
    "external-update",
    async () => {
      await backend({
        type: "perf-external-title",
        ...document,
        title: changedTitle,
      });
      await page.waitForFunction(
        (title) =>
          document
            .querySelector('[id^="workspace-tab-"][aria-selected="true"]')
            ?.textContent?.includes(title),
        changedTitle,
      );
      await ready(document);
      return {
        receivedTitle: changedTitle,
        source: "real FileStore write outside the renderer",
      };
    },
    0,
    false,
    undefined,
    false,
  );
  await backend({
    type: "perf-external-title",
    ...document,
    title: document.title,
  });
  await page.waitForFunction(
    (title) =>
      document.querySelector(
        '[id^="workspace-tab-"][aria-selected="true"] > span:last-child',
      )?.textContent === title,
    document.title,
  );
  await ready(document);

  const root = page
    .locator(surface(document))
    .filter({ visible: true })
    .first();
  const editor = root
    .locator('.ProseMirror[contenteditable="true"]')
    .filter({ visible: true })
    .first();
  await editor.waitFor();
  const containsMarker = (marker, expected) =>
    page.waitForFunction(
      ({ selector, marker, expected }) =>
        [...document.querySelectorAll(selector)].some(
          (el) =>
            el.getClientRects().length &&
            el.textContent.includes(marker) === expected,
        ),
      { selector: surface(document), marker, expected },
    );
  const focusText = async () => {
    const candidates = editor.locator("p");
    const editableIndex = await editor.evaluate((root) =>
      [...root.querySelectorAll("p")].findIndex((el) => {
        if (
          !el.isContentEditable ||
          el.closest(".ProseMirror") !== root ||
          !el.getBoundingClientRect().height ||
          !el.textContent.trim()
        )
          return false;
        for (
          let parent = el.parentElement;
          parent && parent !== root;
          parent = parent.parentElement
        )
          if (
            parent.classList.contains("sb-block") ||
            parent.contentEditable === "false"
          )
            return false;
        return true;
      }),
    );
    assert.ok(
      editableIndex >= 0,
      "No visible editable text in the selected editor",
    );
    let paragraph = candidates.nth(editableIndex);
    const blockId = await paragraph.getAttribute("data-block-id");
    if (blockId)
      paragraph = root
        .locator(`p[data-block-id=${JSON.stringify(blockId)}]`)
        .filter({ visible: true })
        .first();
    await paragraph.scrollIntoViewIfNeeded();
    const point = await paragraph.evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (
          !node.textContent.trim() ||
          !node.parentElement.isContentEditable ||
          node.parentElement.closest("a,button")
        )
          continue;
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 1);
        const box = range.getBoundingClientRect();
        if (box.width && box.height) {
          const paragraphBox = el.getBoundingClientRect();
          return {
            x: box.left + box.width / 2 - paragraphBox.left,
            y: box.top + box.height / 2 - paragraphBox.top,
          };
        }
      }
      throw new Error("No editable text glyph to click");
    });
    await paragraph.dblclick({ position: point });
  };
  for (let i = 0; i < rounds; i++) {
    await focusText();
    const marker = `perf-${i}-${Date.now().toString(36)}`;
    const typed = await measure(
      "type-text",
      async () => {
        const focus = await page.evaluate(() => ({
          tag: document.activeElement?.tagName,
          className: document.activeElement?.className,
          editable: document.activeElement?.isContentEditable,
          selection: window
            .getSelection()
            ?.anchorNode?.parentElement?.outerHTML.slice(0, 400),
        }));
        assert.ok(
          focus.editable,
          `Typing focus is not editable: ${JSON.stringify(focus)}`,
        );
        await page.keyboard.type(marker, { delay: 25 });
        await containsMarker(marker, true);
        return {
          characters: marker.length,
          edit: "replace a double-clicked word",
          typingDelayMs: 25,
          keyLatency:
            "Use observed Event Timing and lastInputToReadyMs, not total typing duration",
        };
      },
      i,
    );
    if (typed.failure) break;
    const saving = await measure(
      "save-edit",
      async () => {
        await page.keyboard.press("ControlOrMeta+s");
        await saved();
        return { savedIndicator: true };
      },
      i,
      false,
      async () =>
        assert.ok(
          JSON.stringify((await read()).document.content).includes(marker),
        ),
    );
    if (saving.failure) break;
    const undo = await measure(
      "undo-edit",
      async () => {
        await page.keyboard.press("ControlOrMeta+z");
        await containsMarker(marker, false);
        return { originalTextRestored: true };
      },
      i,
    );
    if (undo.failure) break;
    const redo = await measure(
      "redo-edit",
      async () => {
        await page.keyboard.press("ControlOrMeta+Shift+z");
        await containsMarker(marker, true);
        return { insertedTextRestored: true };
      },
      i,
    );
    if (redo.failure) break;
    await page.keyboard.press("ControlOrMeta+z");
    await containsMarker(marker, false);
    await page.keyboard.press("ControlOrMeta+s");
    await saved();
  }
  const documentTab = await page
    .locator('[id^="workspace-tab-"][aria-selected="true"]')
    .getAttribute("id");
  await page.locator(".studio-tab-add").click();
  await clickPage(board);
  const boardTab = await page
    .locator('[id^="workspace-tab-"][aria-selected="true"]')
    .getAttribute("id");
  await page.locator(`[id="${documentTab}"]`).click();
  await ready(document);
  await focusText();
  const handoffMarker = `handoff-${Date.now().toString(36)}`;
  await measure(
    "edit-and-switch",
    async () => {
      await page.keyboard.type(handoffMarker);
      await containsMarker(handoffMarker, true);
      await page.locator(`[id="${boardTab}"]`).click();
      await ready(board);
      return { targetPage: board.pageId, pendingEdit: true };
    },
    0,
    false,
    async () => {
      await page.waitForFunction(
        async ({ projectId, pageId, marker }) =>
          JSON.stringify(
            (await window.showai.invoke("pages:get", { projectId, pageId }))
              .document.content,
          ).includes(marker),
        { ...document, marker: handoffMarker },
      );
    },
  );
  await page.locator(`[id="${documentTab}"]`).click();
  await ready(document);
  await focusText();
  await measure(
    "undo-after-navigation",
    async () => {
      await page.keyboard.press("ControlOrMeta+z");
      await containsMarker(handoffMarker, false);
      return { retainedUndo: true };
    },
    0,
  );
  await page.keyboard.press("ControlOrMeta+s");
  await saved();
  await resource("after-authoring-idle", 5000);

  const firstTab = root.locator(".stepper-tab").first();
  if (await firstTab.count()) {
    const group = firstTab.locator("..");
    const tabs = group.getByRole("tab");
    if ((await tabs.count()) > 1) {
      await firstTab.scrollIntoViewIfNeeded();
      for (let i = 0; i < rounds; i++) {
        const target = tabs.nth((i + 1) % 2);
        await measure(
          "component-interaction",
          async () => {
            await target.click();
            await page.waitForFunction(() =>
              [
                ...document.querySelectorAll(
                  '.stepper-tab[aria-selected="true"]',
                ),
              ].some((el) => el.getClientRects().length),
            );
            assert.equal(await target.getAttribute("aria-selected"), "true");
            return { selectedTab: await target.textContent() };
          },
          i,
        );
      }
    }
  } else
    report.coverage.componentInteraction =
      "No supported tabbed component in the selected page; not measured";
  await root.evaluate((el) => {
    el.scrollTop = 0;
  });
  const docBox = await root.boundingBox();
  await page.mouse.move(
    docBox.x + docBox.width - 30,
    docBox.y + docBox.height / 2,
  );
  await measure(
    "continuous-scroll",
    async () => {
      const initial = await root.evaluate((el) => el.scrollTop);
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, 90);
        await delay(40);
      }
      await ready(document);
      const final = await root.evaluate((el) => el.scrollTop);
      assert.ok(final > initial + 500);
      return {
        distance: final - initial,
        wheelEvents: 12,
        scheduledIntervalMs: 40,
      };
    },
    0,
  );

  await clickPage(board, ["ControlOrMeta"]);
  const boardRoot = page
    .locator(surface(board))
    .filter({ visible: true })
    .first();
  const boardBox = await boardRoot.boundingBox();
  await page.mouse.move(
    boardBox.x + boardBox.width * 0.75,
    boardBox.y + boardBox.height * 0.65,
  );
  const camera = () =>
    boardRoot
      .locator(".surface-world")
      .first()
      .evaluate((el) => el.style.transform);
  await measure(
    "canvas-pan",
    async () => {
      const before = await camera();
      for (let i = 0; i < 8; i++) {
        await page.mouse.wheel(60, 40);
        await delay(40);
      }
      const after = await camera();
      assert.notEqual(after, before);
      return { before, after, wheelEvents: 8 };
    },
    0,
  );
  await measure(
    "canvas-zoom",
    async () => {
      const before = await camera();
      await page.keyboard.down("Control");
      try {
        for (let i = 0; i < 6; i++) {
          await page.mouse.wheel(0, -40);
          await delay(40);
        }
      } finally {
        await page.keyboard.up("Control");
      }
      const after = await camera();
      assert.notEqual(after, before);
      return { before, after, wheelEvents: 6 };
    },
    0,
  );

  report.workflowMaterials = materials;
  await resource("workspace-before-cycles", 0);
  for (let cycle = 0; cycle < 2; cycle++) {
    const tabs = [];
    for (const target of materials) {
      await page.locator(".studio-tab-add").click();
      const opened = await measure(
        `workspace-open-${target === materials[0] ? "small" : target === materials.at(-1) ? "large" : "typical"}`,
        async () => {
          await clickPage(target);
          return {
            pageId: target.pageId,
            nodes: target.nodes,
            characters: target.text,
            widgets: target.widgets,
            cycle,
          };
        },
        cycle,
      );
      if (opened.failure) break;
      tabs.push({
        target,
        id: await page
          .locator('[id^="workspace-tab-"][aria-selected="true"]')
          .getAttribute("id"),
      });
    }
    await resource(`workspace-expanded-${cycle}`, 0);
    while (tabs.length) {
      const { id } = tabs.pop();
      const next = tabs.at(-1)?.target ?? board;
      await measure(
        "close-page",
        async () => {
          await page
            .locator(`[id="${id}"]`)
            .locator("..")
            .locator(".studio-tab-close")
            .click();
          await page.locator(`[id="${id}"]`).waitFor({ state: "detached" });
          await ready(next);
          return { closedTab: id, cycle, restoredPage: next.pageId };
        },
        cycle,
      );
    }
    await resource(`workspace-after-close-${cycle}`, 5000);
  }
}

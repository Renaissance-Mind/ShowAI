import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkBoardGestures({ page, api, project, output, poll }) {
  const ids = ["gesture-a", "gesture-b"];
  const created = await api("pages:create", {
    projectId: project.id,
    title: "Board gesture regression",
    document: {
      id: "gesture-page",
      title: "Board gesture regression",
      content: {
        type: "surface",
        attrs: { id: "gesture-root", kind: "board", name: "Board" },
        content: ids.map((id) => ({
          type: "drawing",
          attrs: {
            id,
            tool: "pen",
            name: id,
            color: "#252629",
            strokeWidth: 3,
            extent: [120, 60],
            points: [
              { x: 0, y: 0 },
              { x: 120, y: 60 },
            ],
          },
        })),
      },
      layout: {
        [ids[0]]: { x: 100, y: 100, width: 120, height: 60 },
        [ids[1]]: { x: 500, y: 330, width: 120, height: 60 },
      },
    },
  });
  const pageId = created.document.id;
  const board = page.locator(
    '[data-container-root="gesture-root"] > .container-board-scene > .page-surface',
  );
  const object = (id) =>
    board.locator(`.surface-object[data-surface-id="${id}"]`);
  const read = () => api("pages:get", { projectId: project.id, pageId });
  const close = (actual, expected) => Math.abs(actual - expected) < 0.5;
  const samePositions = (document, positions) =>
    Object.entries(positions).every(
      ([id, value]) =>
        close(document.layout[id].x, value.x) &&
        close(document.layout[id].y, value.y),
    );
  const saved = (positions) =>
    poll(
      read,
      (record) => samePositions(record.document, positions),
      "persisted gesture coordinates",
    );
  const poses = async (selected = ids) =>
    Object.fromEntries(
      await Promise.all(
        selected.map(async (id) => [
          id,
          await object(id).evaluate((element) => ({
            x: parseFloat(element.style.left),
            y: parseFloat(element.style.top),
          })),
        ]),
      ),
    );
  const scale = () =>
    object(ids[0]).evaluate(
      (element) => element.getBoundingClientRect().width / element.offsetWidth,
    );
  const waitForPaint = () =>
    page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
  const result = {
    pageId,
    checks: [],
    trajectories: [],
    overlap: null,
    passed: false,
  };
  await page
    .getByRole("button", { name: project.name, exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Board gesture regression", exact: true })
    .click();
  await object(ids[0]).locator(".board-drawing path").first().waitFor();
  await board.focus();
  await page.keyboard.press("v");
  result.initial = await poll(
    () => board.evaluate((element, pageId) => {
      const object = element.querySelector('[data-surface-id="gesture-a"]');
      const frame = object.getBoundingClientRect();
      const viewport = element.getBoundingClientRect();
      return {
        pageId: element.dataset.inputSurface,
        tool: element.dataset.boardTool,
        locked: element.dataset.viewportLocked,
        settling: element.dataset.settling ?? null,
        focused: document.activeElement === element,
        objectCenterX: frame.x + frame.width / 2,
        viewportCenterX: viewport.x + viewport.width / 2,
        objectTop: frame.y - viewport.y,
        current: element.dataset.inputSurface?.startsWith(`${pageId}:`),
      };
    }, pageId),
    (value) =>
      value.current && value.focused && value.tool === "select" &&
      value.locked === "false" && value.settling === null &&
      close(value.objectCenterX, value.viewportCenterX) &&
      close(value.objectTop, 64),
    "current Board selection tool and initial focused camera geometry",
  );
  await page.evaluate(() => {
    const state = (window.__boardGestureProbe = {
      scenario: "",
      pointer: null,
      inputs: [],
      acknowledgements: [],
    });
    const observe = window.__showaiNativePerf;
    window.__showaiNativePerf = (stage, duration) => {
      observe?.(stage, duration);
      if (stage === "session.save.ackInstall")
        state.acknowledgements.push({
          at: performance.now(),
          duration,
          scenario: state.scenario,
          pointer: state.pointer,
        });
    };
    for (const type of ["pointerdown", "pointerup", "pointercancel"])
      addEventListener(
        type,
        (event) => {
          if (!state.scenario) return;
          if (type === "pointerdown") state.pointer = event.pointerId;
          state.inputs.push({
            type,
            at: performance.now(),
            scenario: state.scenario,
            trusted: event.isTrusted,
            pointer: event.pointerId,
            target: event.target.tagName,
            surfaceId: event.target.closest("[data-surface-id]")?.dataset.surfaceId,
            boardId: event.target.closest("[data-board-id]")?.dataset.boardId,
            point: { x: event.clientX, y: event.clientY },
            worldTransform: document.querySelector('[data-container-root="gesture-root"] .surface-world')?.style.transform,
          });
          if (type !== "pointerdown") state.pointer = null;
        },
        true,
      );
  });
  const startPoint = () =>
    object(ids[0]).evaluate((element) => {
      const path = element.querySelector(".board-drawing path");
      const point = path.getPointAtLength(path.getTotalLength() / 2);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(
        path.getScreenCTM(),
      );
      return {
        x: screen.x,
        y: screen.y,
        worldTransform: path.closest(".surface-world").style.transform,
      };
    });
  const drag = async (name, dx, dy, selected = [ids[0]], previousSave) => {
    const before = await poses(selected);
    const effectiveScale = await scale();
    const start = await startPoint();
    const trajectory = {
      name,
      before,
      scale: effectiveScale,
      start,
      screenDelta: { x: dx, y: dy },
      steps: 45,
      trajectoryMs: 1000,
    };
    result.trajectories.push(trajectory);
    await page.evaluate((name) => {
      window.__boardGestureProbe.scenario = name;
    }, name);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const began = performance.now();
    for (let step = 1; step <= 45; step++) {
      const remaining = began + (step * 1000) / 45 - performance.now();
      if (remaining > 0)
        await new Promise((done) => setTimeout(done, remaining));
      await page.mouse.move(
        start.x + (dx * step) / 45,
        start.y + (dy * step) / 45,
      );
    }
    if (previousSave) {
      await page.waitForFunction(
        (name) =>
          window.__boardGestureProbe.acknowledgements.some(
            (value) => value.scenario === name && value.pointer !== null,
          ),
        name,
      );
      await waitForPaint();
      const persistedBeforeRelease = await read();
      assert.ok(
        samePositions(persistedBeforeRelease.document, previousSave),
        "The previous gesture must actually be persisted while the next pointer is still held",
      );
      assert.ok(
        persistedBeforeRelease.document.content.attrs.inkState,
        "The real saved receipt must carry Board causal metadata",
      );
      result.overlap = {
        scenario: name,
        persistedBeforeRelease: previousSave,
        acknowledgements: await page.evaluate(
          (name) =>
            window.__boardGestureProbe.acknowledgements.filter(
              (value) => value.scenario === name,
            ),
          name,
        ),
      };
    }
    const during = await poses(selected);
    trajectory.during = during;
    for (const id of selected) {
      assert.ok(
        close(during[id].x, before[id].x + dx / effectiveScale),
        `${name}: ${id} must move in scaled surface x coordinates`,
      );
      assert.ok(
        close(during[id].y, before[id].y + dy / effectiveScale),
        `${name}: ${id} must move in scaled surface y coordinates`,
      );
    }
    await page.mouse.up();
    await waitForPaint();
    const final = await poses(selected);
    trajectory.final = final;
    for (const id of selected) {
      assert.ok(
        close(final[id].x, during[id].x) && close(final[id].y, during[id].y),
        `${name}: ${id} must retain its pointer-release pose`,
      );
      assert.ok(
        !close(final[id].x, before[id].x) || !close(final[id].y, before[id].y),
        `${name}: ${id} must commit a real movement`,
      );
    }
    await page.evaluate(() => {
      window.__boardGestureProbe.scenario = "";
    });
    return final;
  };
  try {
    assert.equal(await board.locator(".surface-object.is-selected").count(), 0);
    const first = await drag("unselected-first", 90, 45);
    assert.ok(
      (await object(ids[0]).getAttribute("class"))
        .split(/\s+/)
        .includes("is-selected"),
    );
    const second = await drag(
      "selected-save-overlap",
      -90,
      -45,
      [ids[0]],
      first,
    );
    await saved(second);
    result.checks.push(
      "An unselected object starts dragging, and the following selected drag commits across the previous real save acknowledgement",
    );
    for (let index = 0; index < 4; index++) {
      const sign = index % 2 ? -1 : 1;
      await saved(await drag(`selected-repeat-${index}`, sign * 60, sign * 30));
    }
    result.checks.push(
      "Four further selected drags persist consecutive forward and reverse movements",
    );
    const scaleBeforeZoom = await scale();
    await board.getByLabel("区域与视图", { exact: true }).click();
    await board.getByRole("button", { name: "缩小白板", exact: true }).click();
    await board.getByRole("button", { name: "缩小白板", exact: true }).click();
    await board.getByLabel("区域与视图", { exact: true }).click();
    await poll(
      scale,
      (value) => value < scaleBeforeZoom * 0.8,
      "zoomed Board coordinates",
    );
    await poll(
      () => board.getAttribute("data-settling"),
      (value) => value === null,
      "zoom settled",
    );
    await saved(await drag("zoomed-selected", 60, 30));
    result.checks.push(
      "A zoomed drag converts the real pointer delta to surface coordinates and persists them",
    );
    await board.focus();
    await page.keyboard.press("ControlOrMeta+a");
    assert.equal(await board.locator(".surface-object.is-selected").count(), 2);
    const multiBefore = await poses();
    const multiAfter = await drag("multiple-selected", -60, 30, ids);
    await saved(multiAfter);
    assert.ok(
      close(
        multiAfter[ids[1]].x - multiAfter[ids[0]].x,
        multiBefore[ids[1]].x - multiBefore[ids[0]].x,
      ),
    );
    assert.ok(
      close(
        multiAfter[ids[1]].y - multiAfter[ids[0]].y,
        multiBefore[ids[1]].y - multiBefore[ids[0]].y,
      ),
    );
    await page.getByRole("button", { name: "撤销操作", exact: true }).click();
    await saved(multiBefore);
    await page.getByRole("button", { name: "重做操作", exact: true }).click();
    const final = await saved(multiAfter);
    result.checks.push(
      "A multi-object drag preserves relative positions, and undo/redo restores both persisted frames atomically",
    );
    const probe = await page.evaluate(() => window.__boardGestureProbe);
    assert.ok(
      probe.inputs.length > 0 && probe.inputs.every((value) => value.trusted),
      "Every recorded pointer event must be trusted",
    );
    const overlapDown = probe.inputs.find(
      (value) =>
        value.type === "pointerdown" &&
        value.scenario === result.overlap.scenario,
    );
    const overlapUp = probe.inputs.find(
      (value) =>
        value.type === "pointerup" &&
        value.scenario === result.overlap.scenario,
    );
    assert.ok(
      result.overlap.acknowledgements.some(
        (value) => value.at > overlapDown.at && value.at < overlapUp.at,
      ),
      "A real save acknowledgement must fall between the next drag's pointerdown and pointerup",
    );
    result.inputs = probe.inputs;
    result.passed = true;
    result.finalSourceHash = final.hash;
    await writeFile(
      join(output, "board-gesture-final-page.json"),
      JSON.stringify(final.document, null, 2),
    );
    return { record: final, result };
  } finally {
    await page.mouse.up();
    result.probe = await page.evaluate(() => window.__boardGestureProbe);
    await page.evaluate(() => {
      window.__boardGestureProbe.scenario = "";
    });
    await writeFile(
      join(output, "board-gestures.json"),
      JSON.stringify(result, null, 2),
    );
  }
}

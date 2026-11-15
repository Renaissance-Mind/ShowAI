import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildLevels,
  levelPath,
  sameTarget,
} from "./multi-level-view/model.js";
const data = JSON.parse(
  readFileSync(new URL("./multi-level-view/manifest.json", import.meta.url)),
).defaultData;
test("all eight views are reachable through bound targets and the deepest path changes component type", () => {
  const levels = buildLevels(data);
  assert.equal(levels.size, 8);
  assert.deepEqual(
    levelPath(levels, "validation").map((level) => level.component.kind),
    ["flowchart", "layer-diagram", "flowchart", "layer-diagram"],
  );
  for (const level of data.levels)
    assert.equal(levelPath(levels, level.id)[0].id, data.root);
  assert.ok(
    sameTarget(
      { type: "node", scope: "a", id: "x" },
      { id: "x", scope: "a", type: "node" },
    ),
  );
  assert.ok(
    !sameTarget(
      { type: "node", scope: "a", id: "x" },
      { id: "x", scope: "b", type: "node" },
    ),
  );
});
test("reject cycles, orphan views, missing entry events, non-child routes and duplicate stable targets", () => {
  let bad = structuredClone(data);
  bad.levels[1].parentId = "missing";
  assert.throws(() => buildLevels(bad), /父视图/);
  bad = structuredClone(data);
  bad.levels.find((l) => l.id === "services").parentId = "order";
  assert.throws(() => buildLevels(bad), /循环/);
  bad = structuredClone(data);
  bad.levels[0].bindings.pop();
  assert.throws(() => buildLevels(bad), /进入事件/);
  bad = structuredClone(data);
  bad.levels[0].bindings[0].to = "order";
  assert.throws(() => buildLevels(bad), /直接子视图/);
  bad = structuredClone(data);
  const binding = bad.levels[0].bindings[0];
  bad.levels[0].bindings.push({
    source: {
      id: binding.source.id,
      type: binding.source.type,
      scope: binding.source.scope,
    },
    to: binding.to,
  });
  assert.throws(() => buildLevels(bad), /重复绑定/);
});

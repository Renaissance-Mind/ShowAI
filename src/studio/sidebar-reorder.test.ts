import { expect, it } from "vitest";
import { applySidebarReorder, type SidebarReorder } from "./sidebar-reorder";
import type { SidebarOrganization } from "../core/model";

it("shows consecutive gestures immediately and replays remaining gestures after a failure", () => {
  const saved: SidebarOrganization = {
    groups: [],
    projectGroups: {},
    entryOrder: { project: ["nested", "a", "b", "c"] },
  };
  const first: SidebarReorder = {
    projectId: "project",
    id: "c",
    siblings: ["a", "b", "c"],
    relativeId: "a",
  };
  const second: SidebarReorder = { ...first, id: "b", relativeId: "c" };
  expect(
    [first, second].reduce(applySidebarReorder, saved).entryOrder?.project,
  ).toEqual(["nested", "b", "c", "a"]);
  // The first write failed; remove just that gesture and retain the second.
  expect(
    [second].reduce(applySidebarReorder, saved).entryOrder?.project,
  ).toEqual(["nested", "a", "b", "c"]);
  expect(saved.entryOrder?.project).toEqual(["nested", "a", "b", "c"]);
});

it("preserves manual ordering when unranked pinned pages and folders are included", () => {
  const result = applySidebarReorder(
    { groups: [], projectGroups: {}, entryOrder: { p: ["c"] } },
    {
      projectId: "p",
      id: "a",
      siblings: ["pinned", "folder", "a", "c"],
      relativeId: "c",
    },
  );
  expect(result.entryOrder?.p).toEqual(["a", "c", "pinned", "folder"]);
});

import { expect, it } from "vitest";
import { LibraryHistory, reverseMoves } from "./library-history";
import type { LibraryTarget } from "./LibraryNavigation";

it("undoes newest first, redoes what was undone and drops redo after a new change", () => {
  const history = new LibraryHistory<string>(3);
  history.record("move");
  history.record("delete");
  history.record("rename");
  history.record("batch");
  // The oldest change falls off past the limit.
  expect(history.undo).toEqual(["delete", "rename", "batch"]);
  expect(history.next(false)).toBe("batch");
  history.replayed("batch", false);
  expect(history.next(false)).toBe("rename");
  expect(history.next(true)).toBe("batch");
  history.replayed("batch", true);
  expect(history.next(false)).toBe("batch");
  expect(history.next(true)).toBeUndefined();
  history.replayed("rename", false);
  history.record("new");
  expect(history.redo).toEqual([]);
  // A toast can undo a change that is no longer the newest.
  history.replayed("delete", false);
  expect(history.undo).toEqual(["batch", "new"]);
  expect(history.redo).toEqual(["delete"]);
  history.clear();
  expect(history.next(false)).toBeUndefined();
  expect(history.next(true)).toBeUndefined();
});

it("sends each moved item back where it came from, and again on redo", () => {
  const target: LibraryTarget = {
    kind: "page",
    projectId: "a",
    id: "page",
    title: "Page",
    pinned: false,
    parentId: "folder",
  };
  const moves = [
    {
      target,
      from: { projectId: "a", parentId: "folder" },
      to: { projectId: "b", parentId: null },
    },
  ];
  expect(reverseMoves(moves, false)).toEqual([
    {
      target: { ...target, projectId: "b", parentId: null },
      destination: { projectId: "a", parentId: "folder" },
    },
  ]);
  expect(reverseMoves(moves, true)).toEqual([
    {
      target,
      destination: { projectId: "b", parentId: null },
    },
  ]);
});

import { expect, it } from "vitest";
import { mergeFolders } from "./folder-merge";
import type { FolderMetadata } from "./model";

const folder: FolderMetadata = {
  id: "parent",
  name: "Parent",
  parentId: null,
  pinned: false,
  archived: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

it("merges separate folder preferences and concurrent rename, pin and sort fields", () => {
  const second = { ...folder, id: "child", parentId: folder.id };
  const merged = mergeFolders(
    [folder, second],
    [
      {
        ...folder,
        name: "Renamed",
        sortBy: "createdAt",
        updatedAt: "2026-03-01",
      },
      second,
    ],
    [
      { ...folder, pinned: true, updatedAt: "2026-02-01" },
      { ...second, sortBy: "name" },
    ],
  );
  expect(merged.conflict).toBe(false);
  expect(merged.folders[0]).toMatchObject({
    name: "Renamed",
    pinned: true,
    sortBy: "createdAt",
    updatedAt: "2026-03-01",
  });
  expect(merged.folders[1].sortBy).toBe("name");
});

it("retains actual preference conflicts and delete/edit conflicts", () => {
  expect(
    mergeFolders(
      [folder],
      [{ ...folder, sortBy: "name" }],
      [{ ...folder, sortBy: "createdAt" }],
    ).conflict,
  ).toBe(true);
  expect(
    mergeFolders([folder], [], [{ ...folder, sortBy: "name" }]).conflict,
  ).toBe(true);
  expect(mergeFolders([folder], [], [folder])).toEqual({
    folders: [],
    conflict: false,
  });
});

it("keeps concurrent folder moves from merging into a cycle or missing-parent hierarchy", () => {
  const sibling = { ...folder, id: "sibling" };
  expect(
    mergeFolders(
      [folder, sibling],
      [{ ...folder, parentId: sibling.id }, sibling],
      [folder, { ...sibling, parentId: folder.id }],
    ).conflict,
  ).toBe(true);
  expect(
    mergeFolders(
      [folder, sibling],
      [sibling],
      [folder, { ...sibling, parentId: folder.id }],
    ).conflict,
  ).toBe(true);
});

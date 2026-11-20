import { expect, it } from "vitest";
import type { FolderMetadata, PageSummary } from "../core/model";
import { indexFolderPreviews } from "./folder-previews";

const dates = { createdAt: "2026-01-01", updatedAt: "2026-01-01" };

function folder(id: string, parentId: string | null): FolderMetadata {
  return { id, name: id, parentId, ...dates, pinned: false, archived: false };
}

function page(id: string, parentId: string): PageSummary {
  return {
    id,
    title: id,
    parentId,
    ...dates,
    icon: "",
    hash: id,
    blockCount: 1,
    favorite: false,
    archived: false,
  };
}

it("counts direct children and shows one real cover even through deep folders", () => {
  const folders = Array.from({ length: 8000 }, (_, i) =>
    folder(String(i), i ? String(i - 1) : null),
  );
  folders.push(folder("empty", "0"));
  const pages = ["a", "b", "c", "d"].map((id) => page(id, "7999"));
  const previews = indexFolderPreviews(folders, pages);
  expect(previews.get("0")).toMatchObject({
    count: 2,
    sheets: 3,
    cover: { id: "a" },
  });
  expect(previews.get("7999")).toMatchObject({ count: 4, sheets: 3 });
  expect(previews.get("empty")).toEqual({ count: 0, sheets: 0 });
});

it("prefers direct pages in folder order and a landed page only while it belongs there", () => {
  const root = folder("root", null);
  root.sortBy = "manual";
  const folders = [root, folder("sub", "root")];
  const pages = [page("a", "root"), page("b", "root"), page("c", "sub")];
  const order = ["b", "a"];
  const front = new Map([["root", "a"]]);
  const preview = (preferred?: Map<string, string>) =>
    indexFolderPreviews(folders, pages, order, preferred).get("root");
  expect(preview()?.cover?.id).toBe("b");
  expect(preview(front)?.cover?.id).toBe("a");
  pages[0].parentId = "sub";
  expect(preview(front)?.cover?.id).toBe("b");
  pages[1].parentId = "sub";
  expect(preview()?.count).toBe(1);
  expect(preview()?.cover?.id).toBe("a");
});

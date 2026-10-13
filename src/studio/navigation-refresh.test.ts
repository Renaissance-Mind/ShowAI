import { expect, it } from "vitest";
import {
  emptyNavigationScope,
  queueNavigationScope,
  mergeNavigationProjects,
  retainEqual,
  mergeNavigationScope,
  savedPageMoved,
  withSavedPage,
  withSavedProjectTime,
} from "./navigation-refresh";
import type { PageSummary, ProjectSummary, ShowDocument } from "../core/model";
import { PROJECT_SCOPE_LIMIT } from "../desktop/bridge";

it("merges resource scopes and only falls back to the whole library for unscoped changes", () => {
  const scope = emptyNavigationScope();
  queueNavigationScope(scope, {
    type: "files",
    home: "/library",
    projects: true,
    projectIds: ["a"],
    pageIds: ["page-a"],
  });
  queueNavigationScope(scope, {
    type: "files",
    home: "/library",
    projects: true,
    projectIds: ["b"],
  });
  queueNavigationScope(scope, {
    type: "files",
    home: "/library",
    sidebar: true,
    projectIds: [],
  });
  expect(scope.all).toBe(false);
  expect([...scope.ids]).toEqual(["a", "b"]);
  expect(scope.sidebar).toBe(true);
  queueNavigationScope(scope, { type: "home", home: "/different" });
  expect(scope.all).toBe(true);
});
it("retains a failed scope alongside changes queued during the read", () => {
  const failed = emptyNavigationScope(),
    waiting = emptyNavigationScope();
  queueNavigationScope(failed, {
    type: "files",
    home: "/library",
    projectIds: ["a"],
    sidebar: true,
  });
  queueNavigationScope(waiting, {
    type: "files",
    home: "/library",
    projectIds: ["b"],
  });
  mergeNavigationScope(waiting, failed);
  expect([...waiting.ids]).toEqual(["b", "a"]);
  expect(waiting.sidebar).toBe(true);
  expect(waiting.all).toBe(false);
});
it("falls back to a full refresh before a merged bulk scope exceeds the workbench limit", () => {
  const scope = emptyNavigationScope();
  queueNavigationScope(scope, {
    type: "files",
    home: "/library",
    projectIds: Array.from(
      { length: PROJECT_SCOPE_LIMIT },
      (_, i) => `project-${i}`,
    ),
  });
  expect(scope.all).toBe(false);
  const failed = emptyNavigationScope();
  queueNavigationScope(failed, {
    type: "files",
    home: "/library",
    projectIds: ["extra-project"],
  });
  mergeNavigationScope(scope, failed);
  expect(scope.all).toBe(true);
  expect(scope.ids.size).toBe(0);
});
it("scoped refreshes preserve unrelated project identities and remove missing scoped projects", () => {
  const project = (id: string, updatedAt: string) =>
    ({ id, name: id, updatedAt, pinned: false }) as ProjectSummary;
  const a = project("a", "2026-01-01"),
    b = project("b", "2026-02-01"),
    c = project("c", "2026-03-01");
  const previous = [c, b, a];
  expect(mergeNavigationProjects(previous, [{ ...b }], new Set(["b"]))).toBe(
    previous,
  );
  const next = mergeNavigationProjects(
    previous,
    [{ ...a, updatedAt: "2026-04-01" }],
    new Set(["a", "c"]),
  );
  expect(next.map((project) => project.id)).toEqual(["a", "b"]);
  expect(next[1]).toBe(b);
  expect(retainEqual(previous, next)).toBe(next);
});

it("applies an own save to loaded navigation and keeps unchanged values", () => {
  const summary: PageSummary = {
    id: "page",
    title: "Before",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    icon: "📄",
    hash: "a",
    revision: "r1",
    blockCount: 3,
    parentId: null,
    favorite: false,
    archived: false,
  };
  const contents = { project: { pages: [summary], folders: [] } };
  const document = {
    id: "page",
    title: "After",
    icon: "📄",
    createdAt: summary.createdAt,
    updatedAt: "2026-01-02T00:00:00.000Z",
    parentId: null,
    favorite: false,
    archived: false,
  } as ShowDocument;
  const saved = withSavedPage(contents, "project", {
    document,
    hash: "b",
    revision: "r2",
  });
  expect(saved.project.pages[0]).toEqual({
    ...summary,
    title: "After",
    updatedAt: "2026-01-02T00:00:00.000Z",
    hash: "b",
    revision: "r2",
  });
  expect(
    withSavedPage(saved, "project", { document, hash: "b", revision: "r2" }),
  ).toBe(saved);
  expect(withSavedPage(contents, "other", { document, hash: "b" })).toBe(
    contents,
  );
  expect(savedPageMoved(contents, "project", { document })).toBe(false);
  expect(
    savedPageMoved(contents, "project", {
      document: { ...document, parentId: "folder" },
    }),
  ).toBe(true);
  expect(
    savedPageMoved(contents, "project", {
      document: { ...document, id: "new-page" },
    }),
  ).toBe(true);
  expect(savedPageMoved(contents, "unloaded", { document })).toBe(false);
  const projects = [
    { id: "older", name: "Older", updatedAt: "2026-01-01T12:00:00.000Z" },
    { id: "project", name: "Saved", updatedAt: "2026-01-01T00:00:00.000Z" },
  ] as ProjectSummary[];
  const resorted = withSavedProjectTime(
    projects,
    "project",
    document.updatedAt,
  );
  expect(resorted.map((item) => item.id)).toEqual(["project", "older"]);
  expect(withSavedProjectTime(resorted, "project", summary.updatedAt)).toBe(
    resorted,
  );
});

import { describe, expect, test } from "vitest";
import type { ProjectSummary } from "../core/model";
import { newMenuDestination, recentWritableProject } from "./new-menu";

const project = (
  id: string,
  updatedAt: string,
  extra: Partial<ProjectSummary> = {},
): ProjectSummary => ({
  format: "showai-project",
  version: 1,
  id,
  name: id,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt,
  pageCount: 0,
  ...extra,
});

const projects = [
  project("old", "2026-01-02T00:00:00.000Z"),
  project("newest", "2026-03-01T00:00:00.000Z"),
  project("archived", "2026-05-01T00:00:00.000Z", { archived: true }),
  project("shared", "2026-04-01T00:00:00.000Z"),
];
const sharedReadOnly = (id: string) => id === "shared";

describe("recentWritableProject", () => {
  test("skips archived and read-only projects", () => {
    expect(recentWritableProject(projects, sharedReadOnly)?.id).toBe("newest");
  });
  test("is empty when nothing is writable", () => {
    expect(recentWritableProject(projects, () => true)).toBeUndefined();
    expect(recentWritableProject([], () => false)).toBeUndefined();
  });
});

describe("newMenuDestination", () => {
  test("a writable project in context takes the new content", () => {
    expect(
      newMenuDestination(
        { target: "folder-1", projectId: "old" },
        projects,
        sharedReadOnly,
      ),
    ).toEqual({ kind: "context", target: "folder-1" });
  });
  test("a read-only project in context falls back to the most recent writable one", () => {
    const destination = newMenuDestination(
      { target: "shared", projectId: "shared" },
      projects,
      sharedReadOnly,
    );
    expect(destination.kind === "recent" && destination.project.id).toBe(
      "newest",
    );
  });
  test("no project in context uses the most recent writable one", () => {
    const destination = newMenuDestination(null, projects, sharedReadOnly);
    expect(destination.kind === "recent" && destination.project.id).toBe(
      "newest",
    );
  });
  test("without any writable project a new project is made first", () => {
    expect(newMenuDestination(null, [], () => false)).toEqual({
      kind: "newProject",
    });
    expect(newMenuDestination(null, projects, () => true)).toEqual({
      kind: "newProject",
    });
  });
});

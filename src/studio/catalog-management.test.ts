import { describe, expect, it } from "vitest";
import type { EditablePackage } from "../components/custom/types";
import {
  applyMergeChoices,
  compareVersions,
  conflictLabel,
  divergence,
  exactRef,
  isStillReferenced,
  nextVersion,
  packageRevisions,
  type RevisionItem,
} from "./catalog-management";

const revision = (
  id: string,
  version: string,
  scope: RevisionItem["scope"],
  extra: Partial<RevisionItem> = {},
): RevisionItem => ({
  id,
  name: id,
  version,
  integrity: `sha256-${id}-${version}-${scope}`,
  scope,
  ...extra,
});
const ref = (item: RevisionItem) => exactRef("component", item);

describe("exactRef", () => {
  it("names the owning project only for project revisions", () => {
    expect(
      exactRef("component", revision("a", "1.0.0", "project"), "p1"),
    ).toEqual({
      kind: "component",
      id: "a",
      version: "1.0.0",
      integrity: "sha256-a-1.0.0-project",
      scope: "project",
      projectId: "p1",
    });
    expect(
      exactRef("template", revision("a", "1.0.0", "global"), "p1"),
    ).not.toHaveProperty("projectId");
  });
});

describe("versions", () => {
  it("orders semantic versions numerically with prereleases first", () => {
    expect(
      ["1.10.0", "1.2.0", "1.2.0-beta.2", "1.2.0-beta.10", "0.9.9"].sort(
        compareVersions,
      ),
    ).toEqual(["0.9.9", "1.2.0-beta.2", "1.2.0-beta.10", "1.2.0", "1.10.0"]);
  });

  it("proposes the next free patch of the same minor line", () => {
    expect(nextVersion("1.0.0", [])).toBe("1.0.1");
    expect(nextVersion("1.0.0", ["1.0.0", "1.0.1", "1.0.4", "1.1.0"])).toBe(
      "1.0.5",
    );
    expect(nextVersion("2.3.0-beta.1", ["2.3.0"])).toBe("2.3.1");
    expect(nextVersion("legacy", [])).toBe("1.0.0");
    expect(nextVersion("legacy", ["1.0.0"])).toBe("1.0.1");
  });

  it("lists one package's revisions newest first, project copies before shared ones", () => {
    const items = [
      revision("a", "1.0.0", "global"),
      revision("b", "9.0.0", "project"),
      revision("a", "1.0.0", "project"),
      revision("a", "1.1.0", "published"),
    ];
    expect(
      packageRevisions(items, "a").map(
        (item) => `${item.version}:${item.scope}`,
      ),
    ).toEqual(["1.1.0:published", "1.0.0:project", "1.0.0:global"]);
  });
});

describe("divergence", () => {
  const base = revision("counter", "1.0.0", "global");
  const newer = revision("counter", "1.2.0", "global");
  const published = revision("counter", "1.1.0", "published");
  const older = revision("counter", "0.9.0", "global");

  it("offers newer shared revisions of the origin a project fork started from", () => {
    const fork = revision("counter", "1.0.1", "project", {
      parents: [ref(base)],
    });
    const result = divergence(fork, [fork, base, newer, published, older]);
    expect(result?.base).toBe(base);
    expect(result?.candidates).toEqual([newer, published]);
  });

  it("follows a fork that took a new id", () => {
    const fork = revision("my-counter", "1.0.0", "project", {
      parents: [ref(base)],
    });
    expect(divergence(fork, [fork, base, newer])?.candidates).toEqual([newer]);
  });

  it("starts from the merged origin after a merge and skips merged revisions", () => {
    const mergedFork = revision("counter", "1.0.2", "project", {
      parents: [ref(revision("counter", "1.0.1", "project")), ref(published)],
    });
    expect(
      divergence(mergedFork, [mergedFork, base, published, newer])?.candidates,
    ).toEqual([newer]);
    const upToDate = revision("counter", "1.0.3", "project", {
      parents: [ref(revision("counter", "1.0.2", "project")), ref(newer)],
    });
    expect(divergence(upToDate, [upToDate, base, published, newer])).toBeNull();
  });

  it("ignores shared revisions and copies without a known origin", () => {
    expect(divergence(base, [base, newer])).toBeNull();
    const orphan = revision("counter", "2.0.0", "project", {
      parents: [{ ...ref(base), integrity: "sha256-unknown" }],
    });
    expect(divergence(orphan, [orphan, base, newer])).toBeNull();
  });
});

describe("merge choices", () => {
  const merged: EditablePackage = {
    kind: "component",
    manifest: {
      id: "counter",
      name: "Project name",
      version: "1.0.1",
      description: "Project text",
      entry: "index.tsx",
      scenarios: [],
      defaultData: { "a/b": 1, keep: true },
      examples: [],
    },
    schema: { type: "object" },
    source: "project source",
    files: {},
  };

  it("keeps the project value unless the origin is chosen", () => {
    const conflicts = [
      {
        path: "/manifest/name",
        kind: "value" as const,
        ours: "Project name",
        theirs: "Origin name",
      },
      {
        path: "/source",
        kind: "text" as const,
        ours: "project source",
        theirs: "origin source",
      },
      {
        path: "/manifest/defaultData/a~1b",
        kind: "value" as const,
        ours: 1,
        theirs: 2,
      },
      {
        path: "/manifest/description",
        kind: "value" as const,
        ours: "Project text",
      },
    ];
    const result = applyMergeChoices(merged, conflicts, {
      "/manifest/name": "theirs",
      "/source": "ours",
      "/manifest/defaultData/a~1b": "theirs",
      "/manifest/description": "theirs",
    });
    expect(result.kind === "component" && result.manifest.name).toBe(
      "Origin name",
    );
    expect(result.kind === "component" && result.source).toBe("project source");
    expect(result.kind === "component" && result.manifest.defaultData).toEqual({
      "a/b": 2,
      keep: true,
    });
    expect(
      result.kind === "component" && "description" in result.manifest,
    ).toBe(false);
    expect(merged.kind === "component" && merged.manifest.name).toBe(
      "Project name",
    );
  });

  it("labels conflict paths in reading order", () => {
    expect(conflictLabel("/manifest/defaultData/a~1b~0c")).toBe(
      "manifest › defaultData › a/b~c",
    );
    expect(conflictLabel("/")).toBe("/");
  });
});

describe("isStillReferenced", () => {
  it("recognizes refusals that list references", () => {
    expect(
      isStillReferenced({
        code: "CONFLICT",
        details: { pages: [{ pageId: "x" }] },
      }),
    ).toBe(true);
    expect(
      isStillReferenced({
        code: "CONFLICT",
        details: { references: [{ source: "x" }] },
      }),
    ).toBe(true);
    expect(isStillReferenced({ code: "IN_USE" })).toBe(true);
    expect(
      isStillReferenced({ code: "CONFLICT", details: { pages: [] } }),
    ).toBe(false);
    expect(isStillReferenced(new Error("disk full"))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { groupCatalogReferences } from "./catalog-references";

describe("groupCatalogReferences", () => {
  const names = {
    project: (id: string) =>
      (({ p1: "Alpha", p2: "Beta" }) as Record<string, string>)[id],
    page: (projectId: string, pageId: string) =>
      (({ "p1/x": "Report", "p2/y": "Notes" }) as Record<string, string>)[
        `${projectId}/${pageId}`
      ],
    package: (path: string) =>
      path === "projects/p1/packages/templates/report/1.0.0"
        ? "Quarterly report"
        : undefined,
  };

  it("groups page blocks per page and lists depending packages by scope", () => {
    const result = groupCatalogReferences(
      [
        {
          source: "projects/p2/pages/y.json",
          targetKind: "component",
          targetId: "c",
          version: "1.0.0",
          integrity: "i1",
          blockId: "b3",
        },
        {
          source: "projects/p1/pages/x.json",
          targetKind: "component",
          targetId: "c",
          version: "1.0.0",
          integrity: "i1",
          blockId: "b1",
        },
        {
          source: "projects/p1/pages/x.json",
          targetKind: "component",
          targetId: "c",
          version: "1.1.0",
          integrity: "i2",
          blockId: "b2",
        },
        {
          source: "projects/p1/pages/x.json",
          targetKind: "component",
          targetId: "c",
          version: "1.1.0",
          integrity: "i2",
          blockId: "b2",
        },
        {
          source: "projects/p1/pages/x/reader.json",
          targetKind: "component",
          targetId: "c",
          version: "1.0.0",
          integrity: "i1",
        },
        {
          source: "projects/p1/packages/templates/report/1.0.0/template.json",
          targetKind: "component",
          targetId: "c",
          version: "1.0.0",
          integrity: "i1",
        },
        {
          source: "projects/p1/packages/templates/report/1.0.0/other.json",
          targetKind: "component",
          targetId: "c",
          version: "1.1.0",
          integrity: "i2",
        },
        {
          source: "packages/components/panel/2.0.0/compiled.json",
          targetKind: "component",
          targetId: "c",
        },
        {
          source: "packages/published/templates/deck/1.0.0/template.json",
          targetKind: "component",
          targetId: "c",
        },
        {
          source: "projects/p1/datasets/d.json",
          targetKind: "component",
          targetId: "c",
        },
      ],
      names,
    );
    expect(result.pages).toEqual([
      {
        projectId: "p1",
        projectName: "Alpha",
        pageId: "x",
        title: "Report",
        blockIds: ["b1", "b2"],
        revisions: [
          { version: "1.0.0", integrity: "i1" },
          { version: "1.1.0", integrity: "i2" },
        ],
      },
      {
        projectId: "p2",
        projectName: "Beta",
        pageId: "y",
        title: "Notes",
        blockIds: ["b3"],
        revisions: [{ version: "1.0.0", integrity: "i1" }],
      },
    ]);
    expect(result.packages).toEqual([
      {
        kind: "template",
        id: "deck",
        version: "1.0.0",
        scope: "published",
        revisions: [{}],
      },
      {
        kind: "component",
        id: "panel",
        version: "2.0.0",
        scope: "global",
        revisions: [{}],
      },
      {
        kind: "template",
        id: "report",
        name: "Quarterly report",
        version: "1.0.0",
        scope: "project",
        projectId: "p1",
        projectName: "Alpha",
        revisions: [
          { version: "1.0.0", integrity: "i1" },
          { version: "1.1.0", integrity: "i2" },
        ],
      },
    ]);
  });

  it("falls back to ids when a name is unknown", () => {
    const result = groupCatalogReferences(
      [
        {
          source: "projects/p9/pages/z.json",
          targetKind: "template",
          targetId: "t",
        },
      ],
      names,
    );
    expect(result.pages[0]).toMatchObject({ projectName: "p9", title: "z" });
  });
});

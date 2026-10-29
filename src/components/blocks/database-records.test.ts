import { describe, expect, it } from "vitest";
import { databaseRecordTargets } from "./database-records";

describe("database record preview navigation", () => {
  it("follows the filtered/sorted rows of the clicked page property", () => {
    expect(
      databaseRecordTargets(
        [
          {
            id: "b",
            doc: "showai://project/research/page/two",
            other: "showai://project/research/page/other",
          },
          { id: "empty", doc: "" },
          { id: "invalid", doc: "https://example.com" },
          { id: "a", doc: "showai://project/research/page/one" },
        ],
        "doc",
      ),
    ).toEqual([
      { projectId: "research", pageId: "two", recordId: "b" },
      { projectId: "research", pageId: "one", recordId: "a" },
    ]);
  });

  it("keeps row identity when multiple records point to the same page", () => {
    const doc = "showai://project/research/page/one";
    expect(
      databaseRecordTargets(
        [
          { id: "first", doc },
          { id: "second", doc },
        ],
        "doc",
      ),
    ).toEqual([
      { projectId: "research", pageId: "one", recordId: "first" },
      { projectId: "research", pageId: "one", recordId: "second" },
    ]);
  });
});

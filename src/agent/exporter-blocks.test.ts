import { expect, test } from "vitest";
import type { ShowDocument } from "../types";
import { blockIdsOf } from "./exporter";
import { externalSnapshotReport } from "../core/dataset-resolution";
import { selectDocumentBlocks } from "../portable/selection.mjs";
import type { BindingRead } from "../core/dataset-resolution";

const page = {
  id: "page",
  title: "Partial export",
  content: {
    type: "doc",
    content: [
      {
        type: "widget",
        attrs: {
          id: "note",
          kind: "text",
          data: {
            content: {
              type: "doc",
              content: [
                {
                  type: "widget",
                  attrs: {
                    id: "nested-table",
                    kind: "database",
                    data: { title: "Schedule", $binding: { dataset: "schedule" } },
                  },
                },
              ],
            },
          },
        },
      },
      { type: "paragraph", attrs: { id: "other" }, content: [{ type: "text", text: "Other" }] },
    ],
  },
} as unknown as ShowDocument;

test("a partial export counts bound components nested in the selected block", () => {
  const shown = selectDocumentBlocks(page, ["note"]);
  const blockIds = blockIdsOf(shown);
  expect(blockIds).toContain("nested-table");
  expect(blockIds).not.toContain("other");
  const binding = {
    blockId: "nested-table",
    projectId: "project",
    datasetId: "schedule",
    status: "ok",
    warnings: [],
    snapshotBytes: 12,
    source: { format: "csv", path: "/data/schedule.csv", available: true },
  } as unknown as BindingRead;
  const report = externalSnapshotReport([
    { pageId: "page", bindings: [binding], blockIds },
  ]);
  expect(report.datasets.map((item) => item.blocks)).toEqual([
    [{ pageId: "page", blockId: "nested-table" }],
  ]);
});

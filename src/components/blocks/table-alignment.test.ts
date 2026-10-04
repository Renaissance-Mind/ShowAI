import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TableBlock } from "./Primitives";
import {
  alignTableData,
  tableColumnAlignment,
  validatePrimitiveData,
} from "./primitive-contract.mjs";
import { validateDocument } from "../../portable/validation.mjs";

const data = {
  columns: ["名称", "数量", "说明"],
  rows: [["A", 7, true]],
  align: "left",
};

describe("basic table alignment", () => {
  it("retains inherited alignment, resets overrides for whole-table changes, and preserves source data", () => {
    const column = alignTableData(data, 1, "center");
    expect(column.columnAlignments).toEqual([null, "center", null]);
    expect(
      [0, 1, 2].map((index) => tableColumnAlignment(column, index)),
    ).toEqual(["left", "center", "left"]);
    const all = alignTableData(column, null, "right");
    expect(all.columnAlignments).toBeUndefined();
    expect(all.rows).toBe(data.rows);
    expect(data).toEqual({
      columns: ["名称", "数量", "说明"],
      rows: [["A", 7, true]],
      align: "left",
    });
    expect([0, 1, 2].map((index) => tableColumnAlignment(all, index))).toEqual([
      "right",
      "right",
      "right",
    ]);
  });

  it("validates saved alignment and exports matching headers and cells without editing controls", () => {
    const aligned = alignTableData(
      alignTableData(data, null, "right"),
      1,
      "center",
    );
    const saved = validateDocument({
      id: "alignment",
      title: "表格",
      content: {
        type: "doc",
        content: [
          {
            type: "widget",
            attrs: { kind: "table", data: JSON.parse(JSON.stringify(aligned)) },
          },
        ],
      },
    });
    const html = renderToStaticMarkup(
      createElement(TableBlock, {
        data: saved.content.content![0].attrs!.data,
        readOnly: true,
      }),
    );
    expect(html.match(/text-align:center/g)).toHaveLength(2);
    expect(html.match(/text-align:right/g)).toHaveLength(5); // section, two headers, two values
    expect(html).not.toContain("table-alignment-buttons");
    expect(html).toContain("true");
    expect(() =>
      validatePrimitiveData("table", { ...data, columnAlignments: ["center"] }),
    ).toThrow("列对齐");
    expect(() =>
      validatePrimitiveData("table", {
        ...data,
        columnAlignments: [null, "top", null],
      }),
    ).toThrow("列对齐");
  });
});

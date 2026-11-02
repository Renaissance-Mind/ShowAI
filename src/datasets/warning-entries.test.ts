import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setLocale, translator } from "../i18n";
import messages from "../i18n/messages/datasets";
import { datasetWarning } from "./warnings.mjs";
import {
  agentRequest,
  topLevel,
  warningEntries,
  type WarningEntryInput,
} from "./warning-entries";
import { DataEmptyState, DataWarningBadge } from "./DataWarnings";
import { frameDataState } from "../components/custom/CustomBlock";
import { unavailableText } from "../components/blocks/data-notice";

setLocale("zh-CN");
const t = translator(messages);
const translate = (key: string, values?: Record<string, unknown>) =>
  t(key as never, values as never);
const run = async () => {};

const input = (patch: Partial<WarningEntryInput> = {}): WarningEntryInput => ({
  datasetId: "budget",
  name: "预算",
  names: { actuals: "实际" },
  status: "ok",
  warnings: [],
  datasetEditable: true,
  blockEditable: true,
  pageEditable: true,
  issues: [],
  available: {
    "link-file": true,
    retry: true,
    "open-file": true,
    "ask-agent": true,
    packaging: true,
  },
  ...patch,
});

describe("warning entries of a bound block", () => {
  it("lists warnings by severity with the names of the datasets they concern", () => {
    const entries = warningEntries(
      input({
        status: "stale",
        datasetEditable: false,
        warnings: [
          datasetWarning("SOURCE_MISSING", "actuals", "actuals.csv is gone", {
            level: "warning",
          }),
          datasetWarning(
            "TRANSFORM_FAILED",
            "budget",
            "line 3: x is undefined",
          ),
        ],
        issues: [{ level: "error", message: "rows is not a list." }],
      }),
      translate,
    );
    expect(entries.map((entry) => [entry.code, entry.level])).toEqual([
      ["TRANSFORM_FAILED", "error"],
      ["SOURCE_MISSING", "warning"],
      // Mapping issues are information next to the reading problems.
      ["ISSUE", "info"],
    ]);
    expect(entries[1]).toMatchObject({
      title: "找不到数据文件",
      dataset: "实际",
      stage: "location",
      detail: "actuals.csv is gone",
      actions: ["retry", "link-file"],
    });
    expect(topLevel(entries)).toBe("error");
  });

  it("offers only the actions this block can carry out", () => {
    const [entry] = warningEntries(
      input({
        warnings: [datasetWarning("PARSE_FAILED", "budget", "bad row 2")],
        available: { retry: true },
      }),
      translate,
    );
    expect(entry.actions).toEqual(["retry"]);
  });

  it("says what is read-only, and puts a rejected change first", () => {
    const entries = warningEntries(
      input({
        datasetEditable: false,
        blockEditable: { paths: ["*", "rows[*]", "!rows[id=row:*].title"] },
        source: { kind: "file", format: "xlsx" },
        rejection: "「title」来自只读的数据来源，不能在这里修改。",
      }),
      translate,
    );
    expect(entries.map((entry) => [entry.key, entry.title])).toEqual([
      ["rejection", "「title」来自只读的数据来源，不能在这里修改。"],
      ["read-only", "部分只读"],
    ]);
    expect(entries[1].detail).toContain("XLSX");
    // A reader page has nothing to change, so nothing is called read-only.
    expect(
      warningEntries(
        input({ datasetEditable: false, pageEditable: false }),
        translate,
      ),
    ).toEqual([]);
  });

  it("asks an Agent with the dataset, code and cause", () => {
    const [entry] = warningEntries(
      input({
        warnings: [
          datasetWarning(
            "TRANSFORM_FAILED",
            "budget",
            "line 3: x is undefined",
          ),
        ],
      }),
      translate,
    );
    const prompt = agentRequest(entry, translate);
    expect(prompt).toContain("预算");
    expect(prompt).toContain("budget");
    expect(prompt).toContain("TRANSFORM_FAILED");
    expect(prompt).toContain("line 3: x is undefined");
  });
});

describe("warning surface", () => {
  it("marks stale data in the badge and counts other notices", () => {
    const warnings = [datasetWarning("SOURCE_MISSING", "budget", "gone")];
    const entries = warningEntries(
      input({ status: "stale", datasetEditable: false, warnings }),
      translate,
    );
    const stale = renderToStaticMarkup(
      createElement(DataWarningBadge, { entries, stale: true, run }),
    );
    expect(stale).toContain("已过期");
    expect(stale).toContain("is-warning");
    expect(stale).toContain('aria-haspopup="dialog"');
    const counted = renderToStaticMarkup(
      createElement(DataWarningBadge, { entries, stale: false, run }),
    );
    expect(counted).toContain("1 条提示");
    const readOnly = renderToStaticMarkup(
      createElement(DataWarningBadge, {
        entries: warningEntries(
          input({
            datasetEditable: false,
            blockEditable: false,
            source: { kind: "url", format: "json" },
          }),
          translate,
        ),
        stale: false,
        readOnlyLabel: "只读",
        run,
      }),
    );
    expect(readOnly).toContain("只读");
    expect(readOnly).toContain("is-info");
    expect(
      renderToStaticMarkup(
        createElement(DataWarningBadge, { entries: [], stale: false, run }),
      ),
    ).toBe("");
  });

  it("shows the main warning of an empty block with its first action", () => {
    const [entry] = warningEntries(
      input({
        status: "empty",
        warnings: [
          datasetWarning("SOURCE_NOT_LINKED", "budget", "not linked", {
            level: "error",
          }),
        ],
      }),
      translate,
    );
    const html = renderToStaticMarkup(
      createElement(DataEmptyState, { entry, run }),
    );
    expect(html).toContain("这台设备还没有链接数据文件");
    expect(html).toContain("共享数据 · 预算");
    expect(html).toContain("链接文件…");
    const copy = renderToStaticMarkup(
      createElement(DataEmptyState, {
        entry: { ...entry, actions: ["ask-agent"] },
        run,
        labels: { "ask-agent": t("action.copy-request") },
      }),
    );
    expect(copy).toContain("复制给 Agent 的请求");
  });
});

describe("data state outside the workbench", () => {
  it("gives unbound custom components current, block-wide editability", () => {
    expect(frameDataState(null, false)).toEqual({
      status: "ok",
      editable: true,
    });
    expect(frameDataState(null, true)).toEqual({
      status: "ok",
      editable: false,
    });
    const bound = {
      status: "stale" as const,
      editable: { paths: ["*", "rows[*]"] },
    };
    expect(frameDataState(bound, false)).toBe(bound);
    expect(frameDataState(bound, true)).toEqual({
      status: "stale",
      editable: false,
    });
  });

  it("names only the file of an empty bound block in readers and exports", () => {
    expect(
      unavailableText({
        $binding: { dataset: "budget" },
        $dataState: { status: "empty", dataset: "预算", file: "budget.xlsx" },
      }),
    ).toBe(
      "共享数据「预算」读取的文件「budget.xlsx」在生成此页面时无法读取，这里没有数据。",
    );
    expect(
      unavailableText({
        $binding: { dataset: "total" },
        $dataState: { status: "empty", dataset: "合计" },
      }),
    ).toBe("共享数据「合计」在生成此页面时还没有数据。");
    expect(unavailableText({ $binding: { dataset: "x" } })).toBe(
      "此组件的数据来自共享数据，在当前位置无法读取。",
    );
  });
});

import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { applyDatasetWrite, type DatasetDocument } from "./dataset-file";

const dataset = (value: unknown): DatasetDocument => ({
  format: "showai-dataset",
  version: 1,
  id: "okr",
  name: "OKR",
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
  value,
});
const tasks = (...items: object[]) => ({ tasks: items });

describe("dataset file rules", () => {
  it("bundle without host APIs for the mobile apps", async () => {
    // A Node built-in in this module graph would fail the browser build.
    const result = await build({
      entryPoints: [
        fileURLToPath(new URL("./dataset-file.ts", import.meta.url)),
      ],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      logLevel: "silent",
    });
    expect(result.outputFiles[0].text).not.toMatch(/node:/);
  });

  it("merge a write from an older read with changes made since", () => {
    const current = dataset(
      tasks({ id: "a", title: "A", done: true }, { id: "b", title: "B" }),
    );
    const write = applyDatasetWrite(
      current,
      {
        operations: [
          { op: "set", path: ["tasks", { id: "b" }, "title"], value: "B2" },
        ],
      },
      {
        sameBase: false,
        base: tasks({ id: "a", title: "A" }, { id: "b", title: "B" }),
      },
    );
    expect(write.status).toBe("changed");
    expect(write.status === "changed" && write.dataset.value).toEqual(
      tasks({ id: "a", title: "A", done: true }, { id: "b", title: "B2" }),
    );
  });

  it("hold a write to a field that changed since it was read", () => {
    const current = dataset(tasks({ id: "a", title: "theirs" }));
    const write = applyDatasetWrite(
      current,
      {
        operations: [
          {
            op: "set",
            path: ["tasks", { id: "a" }, "title"],
            value: "mine",
            before: "A",
          },
        ],
      },
      { sameBase: false },
    );
    expect(write).toEqual({
      status: "conflicts",
      conflicts: [expect.objectContaining({ mine: "mine", theirs: "theirs" })],
    });
  });

  it("ask for a new read when the read value is unknown", () => {
    const write = applyDatasetWrite(
      dataset(tasks()),
      { operations: [{ op: "set", path: ["tasks"], value: [] }] },
      { sameBase: false },
    );
    expect(write).toEqual({ status: "missing-baseline" });
  });

  it("rename without touching the value", () => {
    const current = dataset(tasks({ id: "a" }));
    const write = applyDatasetWrite(
      current,
      { operations: [], name: " Goals " },
      { sameBase: true },
    );
    expect(write).toMatchObject({
      status: "changed",
      valueChanged: false,
      metadataChanged: true,
      dataset: { name: "Goals", value: current.value },
    });
  });
});

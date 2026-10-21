import { describe, expect, it } from "vitest";
import {
  mergeDatasetVersions,
  validateDataset,
  type DatasetDocument,
} from "./datasets";
import { mergeProjectFiles } from "../sync/transfer";
import { changedResources } from "./change-notification";

const version = (
  value: unknown,
  extra: Partial<DatasetDocument> = {},
): DatasetDocument => ({
  format: "showai-dataset",
  version: 1,
  id: "okr",
  name: "OKR",
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
  value,
  ...extra,
});
const tasks = (...items: object[]) => ({ tasks: items });

describe("dataset files", () => {
  it("validate their value against an attached schema", () => {
    const schema = {
      type: "object",
      required: ["tasks"],
      properties: { tasks: { type: "array" } },
    };
    expect(() => validateDataset(version({}, { schema }))).toThrow(/tasks/);
    expect(validateDataset(version(tasks(), { schema })).id).toBe("okr");
  });

  it("merge two devices per record and field during sync", () => {
    const base = version(
      tasks({ id: "a", title: "A" }, { id: "b", title: "B" }),
    );
    const local = version(
      tasks({ id: "a", title: "A2" }, { id: "b", title: "B" }),
      { updatedAt: "2026-10-21T01:00:00.000Z" },
    );
    const remote = version(
      tasks(
        { id: "a", title: "A" },
        { id: "b", title: "B", due: "2026-10-30" },
        { id: "c", title: "C" },
      ),
      { name: "OKR 2" },
    );
    const merged = mergeDatasetVersions(base, local, remote);
    expect(merged.conflicts).toEqual([]);
    expect(merged.dataset.name).toBe("OKR 2");
    expect(merged.dataset.value).toEqual(
      tasks(
        { id: "a", title: "A2" },
        { id: "b", title: "B", due: "2026-10-30" },
        { id: "c", title: "C" },
      ),
    );
  });

  it("keep the remote value of a field changed on both devices and report it", () => {
    const path = "projects/p/datasets/okr.json";
    const bytes = (value: DatasetDocument) =>
      Buffer.from(JSON.stringify(value));
    const result = mergeProjectFiles(
      new Map([
        [
          path,
          bytes(
            version(tasks({ id: "a", title: "A" }, { id: "b", title: "B" })),
          ),
        ],
      ]),
      new Map([
        [
          path,
          bytes(
            version(
              tasks({ id: "a", title: "mine" }, { id: "b", title: "B2" }),
            ),
          ),
        ],
      ]),
      new Map([
        [
          path,
          bytes(
            version(
              tasks({ id: "a", title: "theirs" }, { id: "b", title: "B" }),
            ),
          ),
        ],
      ]),
    );
    expect(result.conflicts).toEqual([
      expect.objectContaining({ path, fields: ["tasks[id=a].title"] }),
    ]);
    expect(JSON.parse(result.files.get(path)!.toString()).value).toEqual(
      tasks({ id: "a", title: "theirs" }, { id: "b", title: "B2" }),
    );
  });

  it("announce changed datasets to open windows", () => {
    const change = changedResources("/home", [
      "/home/workspace/projects/p/datasets/okr.json",
    ]);
    expect(change.datasets).toEqual(["p/okr"]);
    expect(change.pageIds).toEqual([]);
    expect(change.projectIds).toEqual(["p"]);
  });
});

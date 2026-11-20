import { describe, expect, it } from "vitest";
import { retainSyncConflicts } from "./conflict-retention";
import { parseArtifact } from "../portable/validation.mjs";
import { mergeProjectFiles, sameFiles } from "./transfer";
const projectId = "9c528830-50db-4d55-8de2-6c6e8f7568b0";
const path = `projects/${projectId}/assets/example.png`;
const source = (account: string) => ({
  account,
  deviceId: account + "-device",
  revision: account + "-revision",
});
describe("shared conflict copies", () => {
  it("reconciles retained pages and records written with different JSON formatting without retaining them again", () => {
    const original = Buffer.from("first"),
      edited = Buffer.from("second");
    const kept = retainSyncConflicts({
      projectId,
      files: new Map([[path, original]]),
      localFiles: new Map([[path, original]]),
      remoteFiles: new Map([[path, edited]]),
      conflicts: [
        {
          path,
          base: null,
          local: original.toString("base64"),
          remote: edited.toString("base64"),
        },
      ],
      local: source("Mac"),
      remote: source("Other"),
    }).files;
    const draft = new Map(kept),
      stored = new Map(kept);
    for (const [name, bytes] of kept) {
      if (!name.endsWith(".json")) continue;
      const json = JSON.parse(bytes.toString());
      draft.set(name, Buffer.from(JSON.stringify(json, null, 2)));
      stored.set(name, Buffer.from(JSON.stringify(json, null, 2) + "\n"));
    }
    expect(mergeProjectFiles(new Map(), stored, draft).conflicts).toEqual([]);
    expect(sameFiles(stored, draft)).toBe(true);
    const raw = [...kept.keys()].find((name) => name.endsWith("local.input"))!;
    draft.set(raw, Buffer.concat([stored.get(raw)!, Buffer.from("\n")]));
    expect(
      mergeProjectFiles(new Map(), stored, draft).conflicts.map(
        (item) => item.path,
      ),
    ).toEqual([raw]);
    expect(sameFiles(stored, draft)).toBe(false);
    const sourcePath = `projects/${projectId}/components/example/source.json`;
    expect(
      sameFiles(
        new Map([[sourcePath, Buffer.from("{}")]]),
        new Map([[sourcePath, Buffer.from("{}\n")]]),
      ),
    ).toBe(false);
  });
  it("keeps exact binary bytes, two visible source pages and an idempotent shared record", () => {
    const local = Buffer.from([0, 255, 12]),
      remote = Buffer.from([0, 254, 11]);
    const input = {
      projectId,
      files: new Map([[path, local]]),
      localFiles: new Map([[path, local]]),
      remoteFiles: new Map([[path, remote]]),
      conflicts: [
        {
          path,
          base: null,
          local: local.toString("base64"),
          remote: remote.toString("base64"),
        },
      ],
      local: source("Mac"),
      remote: source("Linux"),
    };
    const result = retainSyncConflicts(input),
      record = result.records[0];
    expect(result.files.get(path)).toEqual(remote);
    expect(record.variants).toHaveLength(2);
    for (const variant of record.variants) {
      expect(result.files.get(variant.path)).toEqual(
        variant.source.account === "Mac" ? local : remote,
      );
      const page = parseArtifact(
        JSON.parse(
          result.files
            .get(`projects/${projectId}/pages/${variant.pageId}.json`)!
            .toString(),
        ),
      ).document;
      expect(page.title).toContain(variant.source.account);
    }
    const repeated = retainSyncConflicts({
      ...input,
      files: result.files,
      remoteFiles: result.files,
    });
    expect(repeated.records).toHaveLength(0);
    expect(repeated.files.size).toBe(result.files.size);
  });
  it("coalesces provenance for the same archived inputs without turning record.json into another page", () => {
    const local = Buffer.from("local data"),
      remote = Buffer.from("remote data");
    const sources = {
      projectId,
      local: source("Mac"),
      remote: source("Other"),
    };
    const first = retainSyncConflicts({
      ...sources,
      files: new Map([[path, local]]),
      localFiles: new Map([[path, local]]),
      remoteFiles: new Map([[path, remote]]),
      conflicts: [
        {
          path,
          base: null,
          local: local.toString("base64"),
          remote: remote.toString("base64"),
        },
      ],
    });
    const record = first.records[0];
    const recordPath = `projects/${projectId}/conflicts/${record.id}/record.json`;
    const remoteFiles = new Map(first.files);
    remoteFiles.set(
      recordPath,
      Buffer.from(JSON.stringify({ ...record, at: "2025-01-01T00:00:00Z" })),
    );
    const merge = mergeProjectFiles(new Map(), first.files, remoteFiles);
    expect(merge.conflicts.map((item) => item.path)).toEqual([recordPath]);
    const kept = retainSyncConflicts({
      ...sources,
      ...merge,
      localFiles: first.files,
      remoteFiles,
    });
    expect(kept.records).toHaveLength(0);
    expect(kept.files).toEqual(remoteFiles);

    const inputPath = record.variants[0].path;
    remoteFiles.set(inputPath, Buffer.from("different archived data"));
    const corrupt = mergeProjectFiles(new Map(), first.files, remoteFiles);
    expect(() =>
      retainSyncConflicts({
        ...sources,
        ...corrupt,
        localFiles: first.files,
        remoteFiles,
      }),
    ).toThrow();
  });
  it("preserves a deletion as a labeled record instead of losing the other device's edits", () => {
    const local = Buffer.from("edited while another device deleted this file");
    const result = retainSyncConflicts({
      projectId,
      files: new Map([[path, local]]),
      localFiles: new Map([[path, local]]),
      remoteFiles: new Map(),
      conflicts: [
        { path, base: null, local: local.toString("base64"), remote: null },
      ],
      local: source("Mac"),
      remote: source("Linux"),
    });
    const versions = result.records[0].variants;
    expect(
      versions.find((item) => item.source.account === "Linux")?.deleted,
    ).toBe(true);
    expect(versions.find((item) => item.deleted)?.title).toContain("已删除");
    expect(
      result.files.get(versions.find((item) => !item.deleted)!.path),
    ).toEqual(local);
    expect(result.files.has(path)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { retainSyncConflicts } from "./conflict-retention";
import { parseArtifact } from "../portable/validation.mjs";
const projectId = "9c528830-50db-4d55-8de2-6c6e8f7568b0";
const path = `projects/${projectId}/assets/example.png`;
const source = (account: string) => ({
  account,
  deviceId: account + "-device",
  revision: account + "-revision",
});
describe("shared conflict copies", () => {
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicRename } from "./atomic-rename";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});
const fixtures: string[] = [];
afterEach(async () => {
  vi.mocked(rename).mockReset();
  vi.mocked(rename).mockImplementation(
    (
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      )
    ).rename,
  );
  await Promise.all(
    fixtures.splice(0).map((path) => rm(path, { recursive: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "showai-atomic-rename-"));
  fixtures.push(root);
  const source = join(root, "pending.tmp"),
    destination = join(root, "config.json");
  await writeFile(source, "new content");
  await writeFile(destination, "old content");
  return { source, destination };
}

describe("atomic replacement", () => {
  it.skipIf(process.platform !== "win32")(
    "recovers from a temporary Windows sharing violation",
    async () => {
      const { source, destination } = await fixture();
      vi.mocked(rename).mockRejectedValueOnce(
        Object.assign(new Error("sharing violation"), { code: "EPERM" }),
      );
      await atomicRename(source, destination);
      expect(await readFile(destination, "utf8")).toBe("new content");
      await expect(readFile(source)).rejects.toMatchObject({ code: "ENOENT" });
      expect(rename).toHaveBeenCalledTimes(2);
    },
  );
  it("preserves both files when permission failure persists", async () => {
    const { source, destination } = await fixture();
    vi.mocked(rename).mockRejectedValue(
      Object.assign(new Error("access denied"), { code: "EACCES" }),
    );
    await expect(atomicRename(source, destination)).rejects.toMatchObject({
      code: "EACCES",
    });
    expect(await readFile(source, "utf8")).toBe("new content");
    expect(await readFile(destination, "utf8")).toBe("old content");
    expect(rename).toHaveBeenCalledTimes(process.platform === "win32" ? 6 : 1);
  });
  it("does not retry a missing source", async () => {
    const { source, destination } = await fixture();
    await rm(source);
    await expect(atomicRename(source, destination)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(destination, "utf8")).toBe("old content");
    expect(rename).toHaveBeenCalledTimes(1);
  });
});

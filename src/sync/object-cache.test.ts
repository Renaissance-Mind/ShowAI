import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { retainCachedObject } from "./object-cache";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "showai-object-cache-"));
  directories.push(home);
  const bytes = Buffer.from("a reliable immutable object ".repeat(5000));
  const digest = createHash("sha256").update(bytes).digest("hex");
  return {
    home,
    bytes,
    digest,
    path: join(home, "local", "sync", "objects", digest),
  };
}
describe("verified object reuse", () => {
  it("does not replace an unchanged real cache file", async () => {
    const f = await fixture();
    expect(await retainCachedObject(f.home, f.path, f.bytes, f.digest)).toBe(
      true,
    );
    const before = await stat(f.path);
    expect(await retainCachedObject(f.home, f.path, f.bytes, f.digest)).toBe(
      false,
    );
    const after = await stat(f.path);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ctimeMs).toBe(before.ctimeMs);
  });
  it("repairs changed disposable bytes and rejects a wrong source digest", async () => {
    const f = await fixture();
    await retainCachedObject(f.home, f.path, f.bytes, f.digest);
    await writeFile(f.path, "damaged");
    expect(await retainCachedObject(f.home, f.path, f.bytes, f.digest)).toBe(
      true,
    );
    expect(await readFile(f.path)).toEqual(f.bytes);
    await expect(
      retainCachedObject(f.home, f.path, Buffer.from("wrong"), f.digest),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
    expect(await readFile(f.path)).toEqual(f.bytes);
  });
  it("does not follow a cache path replaced with a symbolic link", async () => {
    const f = await fixture();
    await retainCachedObject(f.home, f.path, f.bytes, f.digest);
    const outside = join(f.home, "original.txt");
    await writeFile(outside, "preserve");
    await rm(f.path);
    await symlink(outside, f.path);
    await expect(
      retainCachedObject(f.home, f.path, f.bytes, f.digest),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
    expect(await readFile(outside, "utf8")).toBe("preserve");
  });
});

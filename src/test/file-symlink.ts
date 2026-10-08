import { symlink } from "node:fs/promises";
import type { TestContext } from "vitest";

/** File symlinks require Developer Mode or a privilege on Windows. */
export async function fileSymlink(
  context: TestContext,
  target: string,
  path: string,
) {
  try {
    await symlink(target, path, "file");
  } catch (error) {
    if (
      process.platform !== "win32" ||
      (error as NodeJS.ErrnoException).code !== "EPERM"
    )
      throw error;
    console.warn(
      "File symlink test requires Windows Developer Mode or symlink privilege.",
    );
    context.skip();
  }
}

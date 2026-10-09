import { lstat, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Call after this run's browser/backend processes have exited. */
export async function releaseTestFixtures(output, fixtures) {
  const owner = resolve(output);
  const metadata = await lstat(owner);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error("Test output must be an owned directory, not a symlink.");
  const paths = fixtures.map((path) => resolve(path));
  for (const path of paths)
    if (dirname(path) !== owner)
      throw new Error(
        `Test fixture must be a direct child of ${owner}: ${path}`,
      );
  if (process.env.SHOWAI_KEEP_TEST_FIXTURES === "1") return true;
  for (const path of paths) await rm(path, { recursive: true, force: true });
  return false;
}

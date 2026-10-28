import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Vitest stops its workers without running their process "exit" handlers, and
// Playwright leaves its artifact and profile directories behind when a launch
// fails. Each run therefore gets one temporary directory that its workers,
// browsers and child processes inherit, and the run removes it at the end.
export default async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "showai-vitest-"));
  Object.assign(process.env, {
    TMPDIR: directory,
    TMP: directory,
    TEMP: directory,
  });
  return async () => {
    if (process.env.SHOWAI_KEEP_TEST_FIXTURES === "1") {
      console.log(`Kept test temporary files in ${directory}`);
      return;
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  };
}

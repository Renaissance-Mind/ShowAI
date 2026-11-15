import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

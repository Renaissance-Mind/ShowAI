import { expect, test } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repository = resolve(import.meta.dirname, "../..");
const readerModule = pathToFileURL(
  join(repository, "src/portable/reader-bundle.mjs"),
).href;
const archive = join(repository, "dist-portable/reader-source.json");

test.each([
  { failure: false, explicit: false },
  { failure: true, explicit: false },
  { failure: false, explicit: true },
  { failure: true, explicit: true },
])(
  "reader cache lifecycle: failure=$failure, caller-owned=$explicit",
  async ({ failure, explicit }) => {
    const directory = await mkdtemp(join(tmpdir(), "showai-reader-lifecycle-"));
    const callerCache = join(directory, "caller-cache");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      TMPDIR: directory,
      TMP: directory,
      TEMP: directory,
    };
    delete env.SHOWAI_READER_CACHE;
    if (explicit) env.SHOWAI_READER_CACHE = callerCache;
    try {
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { bundleReader } from ${JSON.stringify(readerModule)};
           import { readdir } from "node:fs/promises";
           import { tmpdir } from "node:os";
           import { join } from "node:path";
           await bundleReader(${JSON.stringify(archive)}, []);
           const directory = process.env.SHOWAI_READER_CACHE ?? join(tmpdir(),
             (await readdir(tmpdir())).find(name => name.startsWith("showai-readers-")));
           console.log(JSON.stringify({ directory, entries: await readdir(directory) }));
           ${failure ? 'throw new Error("reader lifecycle failure");' : ""}`,
        ],
        { cwd: repository, env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (data) => (stdout += data));
      child.stderr.on("data", (data) => (stderr += data));
      const [code] = await once(child, "close");
      expect(code, stderr).toBe(failure ? 1 : 0);
      const generated = JSON.parse(stdout);
      expect(
        generated.entries.some((name: string) => name.endsWith(".json")),
      ).toBe(true);
      expect(await readdir(directory)).toEqual(
        explicit ? ["caller-cache"] : [],
      );
      if (explicit)
        expect(await readdir(callerCache)).toEqual(generated.entries);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

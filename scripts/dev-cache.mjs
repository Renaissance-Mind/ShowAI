import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, rename } from "node:fs/promises";
import { join, relative } from "node:path";

const optionalRead = (path) =>
  readFile(path).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });

// Hash content rather than mtimes so edits, deletions and restored files invalidate.
export function developmentCache(root, directory, mode) {
  const receipt = join(directory, "build-cache.json");
  const configuration = JSON.stringify({
    version: 1,
    mode,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  });
  async function fingerprint(dependencies = []) {
    const paths = new Set(dependencies);
    async function walk(folder) {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) await walk(path);
        else paths.add(path);
      }
    }
    for (const folder of ["src", "scripts", "resources"])
      await walk(join(root, folder));
    for (const path of [
      "package.json",
      "package-lock.json",
      "node_modules/.package-lock.json",
      "vite.config.ts",
      "vite.portable.config.ts",
      "index.html",
      "portable.html",
    ])
      paths.add(join(root, path));
    const hash = createHash("sha256").update(configuration);
    // Limit concurrent reads so large source graphs don't exhaust file handles.
    const sorted = [...paths].sort();
    for (let index = 0; index < sorted.length; index += 64) {
      const files = await Promise.all(
        sorted.slice(index, index + 64).map(optionalRead),
      );
      files.forEach((contents, offset) => {
        hash.update(JSON.stringify(relative(root, sorted[index + offset])));
        hash.update(
          contents === undefined
            ? "missing"
            : createHash("sha256").update(contents).digest("hex"),
        );
      });
    }
    return hash.digest("hex");
  }
  async function outputs(paths) {
    return Promise.all(
      paths.map(async (path) => {
        const content = await optionalRead(path);
        return [
          path,
          content === undefined
            ? null
            : createHash("sha256").update(content).digest("hex"),
        ];
      }),
    );
  }
  return {
    fingerprint,
    async restore() {
      const contents = await optionalRead(receipt);
      if (!contents) return;
      let cached;
      try {
        cached = JSON.parse(contents);
      } catch (error) {
        if (error instanceof SyntaxError) return;
        throw error;
      }
      if (
        !Array.isArray(cached?.dependencies) ||
        !Array.isArray(cached?.outputs)
      )
        return;
      if (
        cached.configuration !== configuration ||
        (await fingerprint(cached.dependencies)) !== cached.fingerprint
      )
        return;
      if (
        JSON.stringify(await outputs(cached.outputs.map(([path]) => path))) !==
        JSON.stringify(cached.outputs)
      )
        return;
      return cached.dependencies;
    },
    async save(before, dependencies, paths) {
      // Never certify a build if a source file changed while it was compiling.
      if (before !== (await fingerprint())) return;
      const data = {
        configuration,
        dependencies: [...dependencies],
        fingerprint: await fingerprint(dependencies),
        outputs: await outputs(paths),
      };
      if (data.outputs.some(([, hash]) => hash === null))
        throw new Error("Development cache output is missing.");
      await writeFile(receipt + ".tmp", JSON.stringify(data));
      await rename(receipt + ".tmp", receipt);
    },
  };
}

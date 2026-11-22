import { unzipSync } from "fflate";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  universalPluginArchive,
  universalPluginFiles,
} from "../src/plugin/universal-package.mjs";

const source = fileURLToPath(new URL("../plugins/showai/", import.meta.url));
const path = fileURLToPath(
  new URL("../downloads/showai-universal.zip", import.meta.url),
);
const check = process.argv.includes("--check");
const current = await readFile(path).catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return undefined;
});

async function matchesSource() {
  if (!current) return false;
  let members;
  try {
    members = unzipSync(current);
  } catch (error) {
    if (check)
      throw new Error("Invalid documentation ZIP. Run npm run docs:build.", {
        cause: error,
      });
    return false;
  }
  const { name, files } = await universalPluginFiles(source);
  return (
    Object.keys(members).length === files.size &&
    [...files].every(([file, bytes]) => {
      const member = members[name + "/" + file];
      return member && bytes.equals(member);
    })
  );
}

if (!(await matchesSource())) {
  if (check)
    throw new Error(
      "The documentation download differs from the universal plugin. Run npm run docs:build.",
    );
  const { bytes } = await universalPluginArchive(source);
  await mkdir(dirname(path), { recursive: true });
  const temp = join(
    dirname(path),
    ".showai-universal-" + randomUUID() + ".tmp",
  );
  try {
    await writeFile(temp, bytes, { flag: "wx" });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

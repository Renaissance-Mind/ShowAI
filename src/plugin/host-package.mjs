// Common Skills have one authoring source; distribution packages bind one host guide.
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, resolve, relative, sep } from "node:path";

export const HOST_PROFILES = {
  codex: "codex-visualize",
  claude: "model-html",
  deepseek: "fragment-file",
  kimi: "fragment-file",
  "mcp-app": "mcp-app",
};
export const HOST_GUIDE = "use-showai/references/host-adapter.md";
const hash = (value) => createHash("sha256").update(value).digest("hex");

export async function skillFiles(root) {
  const files = {};
  async function visit(directory, prefix = "") {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix + entry.name;
      if (entry.isDirectory())
        await visit(join(directory, entry.name), name + "/");
      else if (entry.isFile())
        files[name] = hash(await readFile(join(directory, entry.name)));
      else throw new Error(`Unsupported Skill file: ${name}`);
    }
  }
  await visit(root);
  return files;
}

/** Copy shared instructions unchanged and replace only the bound delivery guide. */
export async function bindHostSkills({ source, target, profile }) {
  if (!Object.hasOwn(HOST_PROFILES, profile))
    throw new Error(`Unknown ShowAI host profile: ${profile}`);
  if (resolve(source) === resolve(target))
    throw new Error(
      "Bind a host profile in a distribution copy, not in the common source.",
    );
  const adapter = await readFile(
    join(source, "host-adapters", `${profile}.md`),
    "utf8",
  );
  const sourceFiles = await skillFiles(join(source, "skills"));
  if (!(HOST_GUIDE in sourceFiles))
    throw new Error(
      "The common Skills must contain the host adapter reference.",
    );
  await rm(join(target, "skills"), { recursive: true, force: true });
  await cp(join(source, "skills"), join(target, "skills"), { recursive: true });
  await writeFile(join(target, "skills", HOST_GUIDE), adapter);
  const commonFiles = Object.fromEntries(
    Object.entries(sourceFiles).filter(([name]) => name !== HOST_GUIDE),
  );
  const copied = await skillFiles(join(target, "skills"));
  const copiedCommon = Object.fromEntries(
    Object.entries(copied).filter(([name]) => name !== HOST_GUIDE),
  );
  if (
    JSON.stringify(copiedCommon) !== JSON.stringify(commonFiles) ||
    JSON.stringify(await skillFiles(join(source, "skills"))) !==
      JSON.stringify(sourceFiles) ||
    (await readFile(join(source, "host-adapters", `${profile}.md`), "utf8")) !==
      adapter
  ) {
    throw new Error(
      "The common Skills or host adapter changed while packaging. Retry after the source settles.",
    );
  }
  const receipt = {
    protocol: "showai-host-profile-v1",
    profile,
    declaredHostDisplay: HOST_PROFILES[profile],
    commonVersion: JSON.parse(
      await readFile(join(source, "plugin.json"), "utf8"),
    ).version,
    commonSha256: hash(JSON.stringify(commonFiles)),
    commonFiles,
    adapterSha256: hash(adapter),
  };
  await writeFile(
    join(target, "host-profile.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  return receipt;
}

/** Generate an installable local plugin while preserving its marketplace identity. */
export async function stageHostPlugin({ source, target, profile }) {
  if (!["codex", "claude"].includes(profile))
    throw new Error(`Use the native bundle packager for ${profile}.`);
  const path = relative(resolve(source), resolve(target));
  if (
    !path ||
    // A target on another Windows drive has no relative path at all.
    (!path.startsWith(".." + sep) && path !== ".." && !isAbsolute(path))
  ) {
    throw new Error("Host packages must be outside the common plugin source.");
  }
  // Replace only a previously generated package, never an unrelated directory.
  const previous = await readFile(
    join(target, "host-profile.json"),
    "utf8",
  ).then(JSON.parse, (error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (
    previous &&
    (previous.protocol !== "showai-host-profile-v1" ||
      previous.profile !== profile)
  ) {
    throw new Error(`Another host owns ${target}.`);
  }
  const entries = await readdir(target).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  if (entries.length && !previous)
    throw new Error(`Refusing to replace a non-generated plugin: ${target}`);
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    filter: (file) => relative(source, file).split(sep)[0] !== "host-adapters",
  });
  const receipt = await bindHostSkills({ source, target, profile });
  if (profile === "codex") {
    await rm(join(target, ".claude-plugin"), { recursive: true, force: true });
    await rm(join(target, ".mcp.json"), { force: true });
  } else await rm(join(target, "mcp.json"), { force: true });
  return receipt;
}

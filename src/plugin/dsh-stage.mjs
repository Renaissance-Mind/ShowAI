// DeepSeek Harness bundle staging, shared by the desktop App and the source installer.
// Harness installs bundles itself (Plugins → Add plugin, or its plugin_manager tool);
// ShowAI only prepares the machine-specific bundle directory and reads the profile state.
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const DSH_BUNDLE = "@showai/dsh-showai";
/** Bundle names of earlier ShowAI previews that the full bundle replaces. */
export const DSH_LEGACY_BUNDLES = [
  "@showai/dsh-showai-preview",
  "@showai/dsh-showai-page",
];
const BUNDLE_FILES = [
  "package.json",
  "cordis.patch.yml",
  "index.js",
  "skills.js",
  "client.js",
  "README.md",
];

export function dshHome() {
  return resolve(process.env.DSH_HOME || join(homedir(), ".dsh"));
}

/** Hash every file path and its bytes under a directory, in a stable order. */
export async function dshFingerprint(root) {
  const files = [];
  async function visit(directory, prefix = "") {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix + entry.name;
      if (entry.isDirectory())
        await visit(join(directory, entry.name), name + "/");
      else if (entry.isFile())
        files.push([
          name,
          createHash("sha256")
            .update(await readFile(join(directory, entry.name)))
            .digest("hex"),
        ]);
      else throw new Error(`Unsupported bundle file: ${name}`);
    }
  }
  await visit(root);
  return {
    verifiedFiles: files.length,
    treeSha256: createHash("sha256")
      .update(JSON.stringify(files))
      .digest("hex"),
  };
}

/** YAML accepts JSON strings, which keeps arbitrary paths and values literal. */
function mcpRow(server) {
  const lines = [
    "    - id: showai-mcp",
    "      name: '@deepseek-ai/dsh-mcp-client'",
    "      config:",
    "        serverName: showai",
    "        transport: stdio",
    `        command: ${JSON.stringify(server.command)}`,
    "        args:",
    ...server.args.map((arg) => `          - ${JSON.stringify(arg)}`),
    "        env:",
    ...Object.entries(server.env).map(
      ([key, value]) =>
        `          ${JSON.stringify(key)}: ${JSON.stringify(value)}`,
    ),
    `        cwd: ${JSON.stringify(server.cwd)}`,
    // Presentation and export calls compile pages; the Harness default of 60 s is too short.
    "        toolCallTimeoutMs: 300000",
  ];
  return lines.join("\n") + "\n";
}

/**
 * Stage the complete bundle at `target`: preview, Skills and the MCP launcher bound to
 * one ShowAI runtime and library. The directory is replaced as a whole.
 */
export async function stageDshBundle({
  target,
  bundleRoot,
  pluginRoot,
  runtime,
  home,
}) {
  if (!isAbsolute(target))
    throw new Error("The DeepSeek Harness bundle target must be absolute.");
  if (!isAbsolute(runtime.command))
    throw new Error("The ShowAI runtime command must be an absolute path.");
  const bundle = JSON.parse(
    await readFile(join(bundleRoot, "package.json"), "utf8"),
  );
  const plugin = JSON.parse(
    await readFile(join(pluginRoot, "plugin.json"), "utf8"),
  );
  if (bundle.name !== DSH_BUNDLE || plugin.name !== "showai")
    throw new Error(
      "Invalid ShowAI DeepSeek Harness bundle or agent plugin source.",
    );
  const before = await dshFingerprint(pluginRoot);
  const version = `${bundle.version}+showai.${plugin.version}`;
  const server = {
    command: runtime.command,
    args: [join(target, "mcp/launch.mjs")],
    env: { ...runtime.env, SHOWAI_HOME: home },
    cwd: target,
  };
  const staging = `${target}.staging-${process.pid}-${Date.now()}`;
  await mkdir(dirname(target), { recursive: true });
  await rm(staging, { recursive: true, force: true });
  try {
    await mkdir(staging);
    for (const file of BUNDLE_FILES)
      await cp(join(bundleRoot, file), join(staging, file));
    await cp(join(pluginRoot, "skills"), join(staging, "skills"), {
      recursive: true,
    });
    await mkdir(join(staging, "mcp"));
    await cp(
      join(pluginRoot, "mcp/launch.mjs"),
      join(staging, "mcp/launch.mjs"),
    );
    await writeFile(
      join(staging, "package.json"),
      JSON.stringify({ ...bundle, version }, null, 2) + "\n",
    );
    const patch = await readFile(join(bundleRoot, "cordis.patch.yml"), "utf8");
    await writeFile(
      join(staging, "cordis.patch.yml"),
      patch.trimEnd() + "\n" + mcpRow(server),
    );
    if ((await dshFingerprint(pluginRoot)).treeSha256 !== before.treeSha256)
      throw new Error(
        "The ShowAI agent plugin changed while staging. Retry after the build finishes.",
      );
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    path: target,
    version,
    home,
    server,
    ...(await dshFingerprint(target)),
  };
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Resolve a `link:` dependency the way pnpm records it, relative to the profile. */
async function linkTarget(spec, profile) {
  if (typeof spec !== "string" || !spec.startsWith("link:")) return undefined;
  const path = resolve(profile, spec.slice(5).replace(/^~(?=\/)/, homedir()));
  return realpath(path).catch(() => path);
}

/** Read-only view of the Harness Desktop profile and what still needs a person's action. */
export async function inspectDshProfile({
  target,
  home = dshHome(),
  skillNames = [],
}) {
  const profile = join(home, "profiles/desktop");
  const text = await readOptional(join(profile, "package.json"));
  const skills = await readdir(join(home, "skills"), {
    withFileTypes: true,
  }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const state = {
    home,
    profile,
    profileFound: text !== undefined,
    installed: false,
    enabled: false,
    otherSource: undefined,
    legacyBundles: [],
    manualMcpRow: false,
    shadowingSkills: skills
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter((name) => skillNames.includes(name)),
  };
  if (text === undefined) return state;
  const manifest = JSON.parse(text);
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };
  const bundles = manifest.dsh?.profile?.bundles ?? [];
  const linked = await linkTarget(dependencies[DSH_BUNDLE], profile);
  const own = target
    ? await realpath(target).catch(() => resolve(target))
    : undefined;
  state.installed =
    dependencies[DSH_BUNDLE] !== undefined && (!own || linked === own);
  if (dependencies[DSH_BUNDLE] !== undefined && !state.installed)
    state.otherSource = linked ?? dependencies[DSH_BUNDLE];
  state.enabled = state.installed && bundles.includes(DSH_BUNDLE);
  state.legacyBundles = DSH_LEGACY_BUNDLES.filter(
    (name) => dependencies[name] !== undefined || bundles.includes(name),
  );
  const patch = (await readOptional(join(profile, "cordis.patch.yml"))) ?? "";
  state.manualMcpRow = /^\s*-?\s*id:\s*['"]?mcp-showai['"]?\s*$/m.test(patch);
  return state;
}

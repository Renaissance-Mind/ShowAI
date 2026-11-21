import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { bindHostSkills, publishPluginDirectory } from "./host-package.mjs";

export const DSH_BUNDLE = "@showai/dsh-showai";
export const DSH_LEGACY_BUNDLES = [
  "@showai/dsh-showai-preview",
  "@showai/dsh-showai-page",
];
export const DSH_BUNDLE_FILES = [
  "package.json",
  "cordis.patch.yml",
  "index.js",
  "workbench.js",
  "skills.js",
  "client.js",
  "README.md",
];

export function dshHome() {
  return resolve(process.env.DSH_HOME || join(homedir(), ".dsh"));
}

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
    "        toolCallTimeoutMs: 300000",
  ];
  return lines.join("\n") + "\n";
}

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
  const existing = await readOptional(join(target, "package.json"));
  const entries = await readdir(target).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  if (entries.length && (!existing || JSON.parse(existing).name !== DSH_BUNDLE))
    throw new Error(`Another package owns the DeepSeek bundle directory: ${target}`);
  const before = await dshFingerprint(pluginRoot);
  const version = `${bundle.version}+showai.${plugin.version}`;
  const server = {
    command: runtime.command,
    args: [join(target, "mcp/launch.mjs")],
    env: {
      ...runtime.env,
      SHOWAI_HOME: home,
      SHOWAI_HOST_DISPLAY: "fragment-file",
    },
    cwd: home,
  };
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(target + ".staging-");
  try {
    for (const file of DSH_BUNDLE_FILES)
      await cp(join(bundleRoot, file), join(staging, file));
    await writeFile(join(staging, "workbench-binding.json"), JSON.stringify({
      home,
      runtimeConfig: server.env.SHOWAI_RUNTIME_CONFIG || join(home, "agent-runtime.json"),
    }) + "\n");
    await bindHostSkills({
      source: pluginRoot,
      target: staging,
      profile: "deepseek",
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
    await publishPluginDirectory(staging, target);
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

async function linkTarget(spec, profile) {
  if (typeof spec !== "string" || !spec.startsWith("link:")) return undefined;
  const path = resolve(profile, spec.slice(5).replace(/^~(?=\/)/, homedir()));
  return realpath(path).catch(() => path);
}

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

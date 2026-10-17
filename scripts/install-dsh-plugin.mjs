#!/usr/bin/env node
// Stage the ShowAI bundle for DeepSeek Harness from source and report what Harness still needs.
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  DSH_BUNDLE,
  dshHome,
  inspectDshProfile,
  stageDshBundle,
} from "../src/plugin/dsh-stage.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flags = new Set();
const options = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--out") {
    if (!process.argv[i + 1]) throw new Error("--out requires a directory.");
    options.set(arg, resolve(process.argv[++i]));
  } else if (["--json", "--help"].includes(arg)) flags.add(arg);
  else throw new Error(`Unknown option ${arg}.`);
}
const json = flags.has("--json");
const log = (message) =>
  (json ? process.stderr : process.stdout).write(message + "\n");

if (flags.has("--help")) {
  log(
    "Usage: node scripts/install-dsh-plugin.mjs [--out DIRECTORY] [--json]\nStages the complete ShowAI bundle for DeepSeek Harness (MCP tools, Skills, inline previews) bound to the runtime registered in SHOWAI_HOME/agent-runtime.json. Default directory: $DSH_HOME/plugins/showai. Harness installs it: Plugins → Add plugin → the directory, then Enable.",
  );
  process.exit(0);
}

const home = resolve(process.env.SHOWAI_HOME || join(homedir(), ".showai"));
const config = JSON.parse(
  await readFile(
    process.env.SHOWAI_RUNTIME_CONFIG || join(home, "agent-runtime.json"),
    "utf8",
  ),
);
if (
  config.format !== "showai-agent-runtime" ||
  resolve(config.home) !== home ||
  !isAbsolute(config.launch?.command)
)
  throw new Error(
    `No ShowAI runtime is registered for ${home}. Start ShowAI or register the runtime first.`,
  );

log("Preparing the ShowAI skills…");
await promisify(execFile)(process.execPath, [
  join(root, "scripts/package-plugin.mjs"),
]);
const pluginRoot = join(root, "plugins/showai");
const target = options.get("--out") ?? join(dshHome(), "plugins/showai");
const receipt = await stageDshBundle({
  target,
  bundleRoot: join(root, "plugins/dsh-showai"),
  pluginRoot,
  runtime: { command: config.launch.command, env: config.launch.env ?? {} },
  home,
});
const state = await inspectDshProfile({
  target,
  skillNames: await readdir(join(pluginRoot, "skills")),
});
const steps = [];
if (!state.profileFound)
  steps.push("Open DeepSeek Harness once so it creates its Desktop profile.");
if (state.otherSource)
  steps.push(
    `Remove the ${DSH_BUNDLE} copy installed from ${state.otherSource} in Harness Plugins.`,
  );
for (const name of state.legacyBundles)
  steps.push(`Remove the earlier ${name} bundle in Harness Plugins.`);
if (state.manualMcpRow)
  steps.push(
    `Delete the hand-written mcp-showai row from ${join(state.profile, "cordis.patch.yml")}.`,
  );
if (state.shadowingSkills.length)
  steps.push(
    `Delete the copied skills in ${join(state.home, "skills")} that shadow the bundle: ${state.shadowingSkills.join(", ")}.`,
  );
if (!state.installed)
  steps.push(`In Harness: Plugins → Add plugin → ${target}, then Enable.`);
else if (!state.enabled) steps.push("In Harness Plugins, switch ShowAI on.");
steps.push("Restart DeepSeek Harness to load the staged files.");

if (json)
  process.stdout.write(
    JSON.stringify({ ok: true, ...receipt, profile: state, steps }, null, 2) +
      "\n",
  );
else {
  log(
    `Staged ${DSH_BUNDLE} ${receipt.version} at ${receipt.path} (${receipt.verifiedFiles} files, library ${home}).`,
  );
  for (const [index, step] of steps.entries()) log(`${index + 1}. ${step}`);
}

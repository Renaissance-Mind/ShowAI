// Refresh the official Claude marketplace before installation, then verify the actual copy.
import { execFile } from "node:child_process";
import { readFile, realpath, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { skillFiles } from "../src/plugin/host-package.mjs";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.slice(2).some((arg) => arg !== "--json"))
  throw new Error("Usage: npm run plugin:claude -- [--json]");
async function claude(args) {
  const result = await execute("claude", ["plugin", ...args, "--json"], {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = result.stdout.trim();
  const body = JSON.parse(
    output.startsWith("{") || output.startsWith("[")
      ? output
      : output.split("\n").at(-1),
  );
  if (body?.outcome && body.outcome !== "ok")
    throw new Error(JSON.stringify(body));
  return body;
}
const packaged = await execute(
  process.execPath,
  [join(root, "scripts/package-plugin.mjs")],
  { cwd: root },
);
process.stderr.write(packaged.stdout);
const marketplace = JSON.parse(
  await readFile(join(root, ".claude-plugin/marketplace.json"), "utf8"),
);
const identity = `showai@${marketplace.name}`;
const markets = await claude(["marketplace", "list"]);
const existing = markets.find((item) => item.name === marketplace.name);
if (
  existing &&
  (existing.source !== "directory" ||
    (await realpath(existing.path)) !== (await realpath(root)))
) {
  throw new Error(
    `Marketplace ${marketplace.name} belongs to another source. Nothing was installed.`,
  );
}
if (!existing) await claude(["marketplace", "add", root]);
else await claude(["marketplace", "update", marketplace.name]);
const source = join(root, "plugins/showai-claude");
const expected = await skillFiles(source);
const before = (await claude(["list"])).find(
  (item) => item.id === identity && item.scope === "user",
);
if (before) await claude(["update", identity, "--scope", "user"]);
else await claude(["install", identity, "--scope", "user"]);
const installed = (await claude(["list"])).find(
  (item) => item.id === identity && item.scope === "user",
);
if (!installed?.enabled || !installed.installPath)
  throw new Error("Claude did not confirm an enabled installed plugin.");
const actual = await skillFiles(installed.installPath);
if (
  JSON.stringify(actual) !== JSON.stringify(expected) ||
  JSON.stringify(await skillFiles(source)) !== JSON.stringify(expected)
) {
  throw new Error(
    "The installed Claude plugin differs from the generated package or the source changed. Refresh its marketplace and retry with a new plugin version.",
  );
}
const profile = JSON.parse(
  await readFile(join(installed.installPath, "host-profile.json"), "utf8"),
);
if (
  profile.profile !== "claude" ||
  profile.declaredHostDisplay !== "model-html"
)
  throw new Error("Claude installed another host's adapter.");
const receipt = {
  ok: true,
  pluginId: identity,
  version: installed.version,
  enabled: installed.enabled,
  sourcePath: source,
  installedPath: installed.installPath,
  verifiedFiles: Object.keys(actual).length,
  commonSha256: profile.commonSha256,
  adapterSha256: profile.adapterSha256,
  verifiedAt: new Date().toISOString(),
  hostRefresh: "Restart or refresh Claude Code to apply the installed files.",
};
await mkdir(join(root, "artifacts"), { recursive: true });
await writeFile(
  join(root, "artifacts/claude-plugin-install.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);
process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");

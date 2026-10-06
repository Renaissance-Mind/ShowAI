#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flags = new Set(process.argv.slice(2));
const json = flags.has("--json");
const log = (message) =>
  (json ? process.stderr : process.stdout).write(message + "\n");
const hash = (input) => createHash("sha256").update(input).digest("hex");

async function command(executable, args) {
  return execute(executable, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).catch((error) => {
    if (error.code === "ENOENT")
      throw new Error(
        `${executable} was not found. Install a current Codex CLI and Node.js 22.12+ before installing this plugin.`,
      );
    throw new Error(
      `${executable} ${args.join(" ")} failed: ${(error.stderr || error.stdout || error.message).trim()}`,
      { cause: error },
    );
  });
}

async function codex(args) {
  const result = await command("codex", ["plugin", ...args, "--json"]);
  if (result.stderr.trim()) process.stderr.write(result.stderr);
  return JSON.parse(result.stdout);
}

async function npmScript(name) {
  const result = process.env.npm_execpath
    ? await command(process.execPath, [process.env.npm_execpath, "run", name])
    : await command("npm", ["run", name]);
  if (result.stdout.trim()) log(result.stdout.trim());
  if (result.stderr.trim()) process.stderr.write(result.stderr);
}

/** Hash source bytes and executable status; never follow a package symlink. */
async function fingerprint(directory) {
  const entries = new Map();
  async function visit(path) {
    for (const item of (await readdir(path)).sort()) {
      const full = join(path, item);
      const name = relative(directory, full).split(sep).join("/");
      const info = await lstat(full);
      if (info.isSymbolicLink()) {
        entries.set(name, { type: "symlink", target: await readlink(full) });
      } else if (info.isDirectory()) {
        entries.set(name, { type: "directory" });
        await visit(full);
      } else if (info.isFile()) {
        entries.set(name, {
          type: "file",
          bytes: info.size,
          executable: !!(info.mode & 0o111),
          sha256: hash(await readFile(full)),
        });
      } else throw new Error(`Unsupported file in plugin bundle: ${name}`);
    }
  }
  await visit(directory);
  const items = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b));
  return {
    entries,
    treeSha256: hash(JSON.stringify(items)),
    files: items.filter(([, entry]) => entry.type === "file").length,
  };
}

async function install() {
  for (const flag of flags)
    if (!["--update", "--json", "--help"].includes(flag))
      throw new Error(`Unknown option ${flag}.`);
  if (flags.has("--help")) {
    log(
      "Usage: node scripts/install-codex-plugin.mjs [--update] [--json]\nValidates the skills-only plugin, then uses official Codex commands to install or refresh it. The ShowAI software runtime is installed separately. Verifies installed bytes and enabled status.",
    );
    return;
  }

  const marketplace = JSON.parse(
    await readFile(join(root, ".agents/plugins/marketplace.json"), "utf8"),
  );
  const pluginRoot = join(root, "plugins/showai");
  const manifest = JSON.parse(
    await readFile(join(pluginRoot, "plugin.json"), "utf8"),
  );
  if (
    !/^[a-z0-9][a-z0-9_-]*$/.test(marketplace.name) ||
    !/^[a-z0-9][a-z0-9_-]*$/.test(manifest.name)
  )
    throw new Error("Invalid local marketplace or plugin name.");
  const entry = marketplace.plugins?.find(
    (item) => item.name === manifest.name,
  );
  if (
    entry?.source?.source !== "local" ||
    resolve(root, entry.source.path) !== pluginRoot
  )
    throw new Error(
      "This installer requires the repository marketplace to point at ./plugins/showai.",
    );
  const identity = `${manifest.name}@${marketplace.name}`;
  const canonicalRoot = await realpath(root);

  // Refuse a name collision before any official command could replace a source.
  const considered = await codex(["marketplace", "list"]);
  if (!Array.isArray(considered.marketplaces))
    throw new Error(
      "Codex returned an unrecognized marketplace list. Update Codex CLI and retry.",
    );
  for (const existing of considered.marketplaces.filter(
    (item) => item.name === marketplace.name,
  )) {
    const sameRoot =
      typeof existing.root === "string" &&
      (await realpath(existing.root).then(
        (path) => path === canonicalRoot,
        () => false,
      ));
    if (
      !sameRoot ||
      (existing.marketplaceSource?.sourceType &&
        existing.marketplaceSource.sourceType !== "local")
    )
      throw new Error(
        `Marketplace ${marketplace.name} already points to another source (${existing.root ?? "unknown"}). Nothing was changed; choose a distinct marketplace name or resolve that source explicitly.`,
      );
  }

  log("Preparing the ShowAI skills…");
  const packaged = await command(process.execPath, [
    join(root, "scripts/package-plugin.mjs"),
  ]);
  if (packaged.stdout.trim()) log(packaged.stdout.trim());
  const expected = await fingerprint(pluginRoot);

  log(`Registering the local marketplace and refreshing ${identity}…`);
  await codex(["marketplace", "add", root]);
  const added = await codex(["add", identity]);
  if (
    typeof added.installedPath !== "string" ||
    !isAbsolute(added.installedPath)
  )
    throw new Error(
      "Codex did not return an absolute installedPath. Installation cannot be verified; inspect codex plugin list before retrying.",
    );
  const installedPath = await realpath(added.installedPath);
  if (installedPath === (await realpath(pluginRoot)))
    throw new Error(
      "Codex returned the source folder as installedPath; a separate installed copy was expected.",
    );
  const actual = await fingerprint(installedPath);
  const after = await fingerprint(pluginRoot);
  if (after.treeSha256 !== expected.treeSha256)
    throw new Error(
      "The source plugin changed during installation. Wait for other builds to finish and run this command again.",
    );
  const mismatches = [
    ...new Set([...expected.entries.keys(), ...actual.entries.keys()]),
  ].filter(
    (path) =>
      JSON.stringify(expected.entries.get(path)) !==
      JSON.stringify(actual.entries.get(path)),
  );
  if (mismatches.length)
    throw new Error(
      `Installed plugin does not match the rebuilt source (${mismatches.length} mismatched paths): ${mismatches.slice(0, 12).join(", ")}. Inspect the installation, then use official 'codex plugin remove ${identity}' and 'codex plugin add ${identity}' to reinstall if needed. This helper will not uninstall it automatically.`,
    );

  const plugins = await codex(["list", "--marketplace", marketplace.name]);
  const installed = plugins.installed?.find(
    (item) => item.pluginId === identity,
  );
  if (!installed?.installed || !installed.enabled)
    throw new Error(
      `Codex did not confirm ${identity} is installed and enabled. Inspect its status in the Plugins panel; local or managed settings may disable it.`,
    );
  if (installed.version !== manifest.version)
    throw new Error(
      `Installed version ${installed.version} differs from the bundle version ${manifest.version}.`,
    );
  const receiptPath = join(root, "artifacts/codex-plugin-install.json");
  const receipt = {
    ok: true,
    action: flags.has("--update") ? "update" : "install",
    pluginId: identity,
    version: manifest.version,
    enabled: true,
    marketplaceRoot: root,
    sourcePath: pluginRoot,
    installedPath,
    verifiedFiles: actual.files,
    treeSha256: actual.treeSha256,
    files: Object.fromEntries(
      [
        "plugin.json",
        "skills/show-document/SKILL.md",
        "skills/create-component/SKILL.md",
        "skills/create-template/SKILL.md",
      ].map((path) => [path, actual.entries.get(path)?.sha256]),
    ),
    verifiedAt: new Date().toISOString(),
    receiptPath,
  };
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  if (json) process.stdout.write(JSON.stringify(receipt) + "\n");
  else
    log(
      `Verified ${identity} ${manifest.version}: ${actual.files} files match the rebuilt bundle.\nInstalled at ${installedPath}\nReceipt: ${receiptPath}\nStart a new Codex conversation to load the updated skill.`,
    );
}

install().catch((error) => {
  process.stderr.write(`ShowAI plugin setup failed: ${error.message}\n`);
  process.exitCode = 1;
});

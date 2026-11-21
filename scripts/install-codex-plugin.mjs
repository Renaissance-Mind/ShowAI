#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  cp,
  lstat,
  link,
  mkdir,
  mkdtemp,
  rename,
  rm,
  readFile,
  readdir,
  readlink,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { publishPluginDirectory } from "../src/plugin/host-package.mjs";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = new Map();
const flags = new Set();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (["--remote-url", "--marketplace-root", "--chatgpt-app", "--workbench-test", "--workbench-channel", "--home"].includes(arg)) {
    if (!process.argv[i + 1]) throw new Error(`${arg} requires a value.`);
    options.set(arg, process.argv[++i]);
  } else flags.add(arg);
}
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

const channel = options.get("--workbench-channel");
const workbenchTestName = channel ? "showai-workbench-test-" + channel : "showai-workbench-test";
const workbenchTestServer = workbenchTestName.replaceAll("-", "_");
const workbenchTitle = channel ? "ShowAI Workbench Test (" + channel + ")" : "ShowAI Workbench Test";

async function optionalJson(path) {
  return readFile(path, "utf8").then(JSON.parse, (error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

async function writeJson(path, value, mode) {
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function assertPackageTarget(directory, name) {
  const manifest = await optionalJson(join(directory, "plugin.json"));
  if (manifest?.name === name) return;
  const entries = await readdir(directory).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  if (entries.length) throw new Error(`Refusing to replace another plugin at ${directory}.`);
}

async function claimTestCheckout(directory) {
  const owner = join(directory, "workbench-checkout.json");
  const checkout = await realpath(root);
  const temp = await mkdtemp(join(directory, ".checkout-"));
  try {
    const prepared = join(temp, "owner.json");
    await writeFile(prepared, JSON.stringify({ checkout }) + "\n");
    await link(prepared, owner).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const saved = await optionalJson(owner);
    if (saved?.checkout !== checkout)
      throw new Error(`Workbench marketplace belongs to ${saved?.checkout}. Use a separate directory and --workbench-channel for this checkout.`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function checkTestServer(binding) {
  const configured = JSON.parse((await command("codex", ["mcp", "list", "--json"])).stdout);
  const existing = configured.find((item) => item.name === workbenchTestServer);
  if (existing && existing.transport?.env?.SHOWAI_RUNTIME_CONFIG !== binding)
    throw new Error(`MCP server ${workbenchTestServer} belongs to another installation. Use a separate --workbench-channel.`);
}

async function writeWorkbenchTestLauncher(pluginRoot) {
  const directory = join(pluginRoot, "mcp");
  if (process.platform === "win32") {
    const command = process.execPath.replaceAll("%", "%%");
    await writeFile(
      join(directory, "showai-mcp.cmd"),
      '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"' + command +
        '" "%~dp0launch.mjs" %*\r\n',
    );
    return "./mcp/showai-mcp.cmd";
  }
  const command = "'" + process.execPath.replaceAll("'", "'\\''") + "'";
  await writeFile(
    join(directory, "showai-mcp"),
    "#!/bin/sh\nexec " + command + ' "$(dirname "$0")/launch.mjs" "$@"\n',
    { mode: 0o755 },
  );
  return "./mcp/showai-mcp";
}

async function stageWorkbenchTest(marketplaceRoot, pluginRoot, home) {
  const compiled = join(root, "dist-runtime");
  const runtimeDigest = createHash("sha256")
    .update(await readFile(join(compiled, "scripts/cli.mjs")))
    .update(await readFile(join(compiled, "web/index.html")))
    .update(await readFile(join(compiled, "scripts/codex-workbench-assets/index.json")))
    .digest("hex")
    .slice(0, 16);
  const runtimeRoot = join(marketplaceRoot, "runtime", runtimeDigest);
  const cli = join(runtimeRoot, "scripts/cli.mjs");
  const library = await realpath(home);
  if (!(await lstat(library)).isDirectory())
    throw new Error("The selected ShowAI content library is not a directory.");

  const marketplace = join(marketplaceRoot, ".agents/plugins/marketplace.json");
  await assertPackageTarget(pluginRoot, workbenchTestName);
  await mkdir(marketplaceRoot, { recursive: true });
  await claimTestCheckout(marketplaceRoot);
  await access(cli).catch(async (error) => {
    if (error.code !== "ENOENT") throw error;
    await mkdir(dirname(runtimeRoot), { recursive: true });
    const temporary = await mkdtemp(join(dirname(runtimeRoot), ".staging-"));
    try {
      await cp(compiled, temporary, {
        recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true,
      });
      await rename(temporary, runtimeRoot);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
  const binding = join(marketplaceRoot, "agent-runtime.json");
  const env = {
    SHOWAI_HOME: library,
    SHOWAI_CODEX_WORKBENCH_PROFILE: join(marketplaceRoot, "profile"),
  };
  const launch = { command: process.execPath, args: [cli], env };
  const runtime = JSON.parse(await readFile(join(runtimeRoot, "assets/build.json"), "utf8"));
  await mkdir(dirname(pluginRoot), { recursive: true });
  const staging = await mkdtemp(join(dirname(pluginRoot), ".workbench-"));
  try {
    await cp(join(root, "plugins/showai-codex"), staging, { recursive: true });
    const mcpPath = join(staging, "mcp.json");
    const mcp = JSON.parse(await readFile(mcpPath, "utf8"));
    const server = mcp.mcpServers.showai;
    server.command = await writeWorkbenchTestLauncher(staging);
    server.args = [];
    Object.assign(server.env, env, {
      SHOWAI_RUNTIME_CONFIG: binding,
      SHOWAI_CODEX_PLUGIN_ID: `${workbenchTestName}@${workbenchTestName}`,
    });
    mcp.mcpServers = { [workbenchTestServer]: server };
    await writeFile(mcpPath, JSON.stringify(mcp, null, 2) + "\n");

    const manifestPath = join(staging, "plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const runtimeHash = createHash("sha256")
      .update(await readFile(cli))
      .update((await fingerprint(staging)).treeSha256)
      .digest("hex")
      .slice(0, 12);
    manifest.name = workbenchTestName;
    manifest.version = `${manifest.version.split("+")[0]}+workbench.${runtimeHash}`;
    manifest.extensions["com.openai"].interface.displayName = workbenchTitle;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    await publishPluginDirectory(staging, pluginRoot);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  await writeJson(binding, {
    format: "showai-agent-runtime", protocol: 1, channel: "development",
    version: runtime.version, home: library, launch, registeredAt: new Date().toISOString(),
  }, 0o600);

  await mkdir(dirname(marketplace), { recursive: true });
  await writeJson(marketplace, {
    name: workbenchTestName,
    interface: { displayName: workbenchTitle },
    plugins: [{
      name: workbenchTestName,
      source: { source: "local", path: "./plugins/" + workbenchTestName },
      policy: { installation: "AVAILABLE", authentication: "ON_USE" },
      category: "Productivity",
    }],
  });
  return { runtime: cli, home: library };
}

async function verifyWorkbenchTestServer(installedPath) {
  const manifest = JSON.parse(await readFile(join(installedPath, "mcp.json"), "utf8"));
  const server = manifest.mcpServers[workbenchTestServer];
  const bundledCommand = join(installedPath, server.command);
  async function configuredServer() {
    const configured = JSON.parse((await command("codex", ["mcp", "list", "--json"])).stdout);
    return configured.find((item) => item.name === workbenchTestServer);
  }
  const bundled = (entry) =>
    entry?.transport?.command === bundledCommand &&
    entry.transport.env?.SHOWAI_RUNTIME_CONFIG === server.env.SHOWAI_RUNTIME_CONFIG &&
    entry.transport.env?.SHOWAI_HOME === server.env.SHOWAI_HOME;

  const existing = await configuredServer();
  if (bundled(existing)) {
    if (!existing.enabled)
      throw new Error("Codex has disabled the MCP server bundled with the test plugin.");
    return workbenchTestServer;
  }
  const legacy = existing?.transport;
  const legacyLauncher = legacy?.args?.[0]?.replaceAll("\\", "/") ?? "";
  if (existing &&
      (legacy?.env?.SHOWAI_RUNTIME_CONFIG !== server.env.SHOWAI_RUNTIME_CONFIG ||
       legacy?.args?.length !== 1 ||
       !legacyLauncher.includes("/" + workbenchTestName + "/" + workbenchTestName + "/") ||
       !legacyLauncher.endsWith("/mcp/launch.mjs")))
    throw new Error("MCP server " + workbenchTestServer + " belongs to another installation.");

  if (legacy) await command("codex", ["mcp", "remove", workbenchTestServer]);
  try {
    const loaded = await configuredServer();
    if (!bundled(loaded) || !loaded.enabled)
      throw new Error("Codex did not load the test MCP from its installed plugin.");
    return workbenchTestServer;
  } catch (error) {
    if (legacy) {
      await command("codex", [
        "mcp", "add", workbenchTestServer,
        ...Object.entries(legacy.env).flatMap(([key, value]) => ["--env", key + "=" + value]),
        "--", legacy.command, ...legacy.args,
      ]);
    }
    throw error;
  }
}

async function install() {
  for (const flag of flags)
    if (!["--update", "--json", "--help"].includes(flag))
      throw new Error(`Unknown option ${flag}.`);
  if (flags.has("--help")) {
    log(
      "Usage: node scripts/install-codex-plugin.mjs [--update] [--json]\n       node scripts/install-codex-plugin.mjs --marketplace-root DIRECTORY [--remote-url MANUAL_SETUP_HINT] [--chatgpt-app asdk_app_ID] [--update] [--json]\nValidates the MCP plugin, then uses official Codex commands to install or refresh it. The universal form installs Skills in a separate marketplace. Configure MCP in the host; --remote-url adds a README hint. Use --workbench-test DIRECTORY --home LIBRARY with a built checkout. Each concurrent checkout can use its own directory and --workbench-channel NAME. The ShowAI software runtime is installed separately. Verifies installed bytes and enabled status.",
    );
    return;
  }
  const remoteUrl = options.get("--remote-url");
  const universalRoot = options.get("--marketplace-root");
  const workbenchTest = options.get("--workbench-test");
  const testHome = options.get("--home");
  if (channel !== undefined && (!workbenchTest || channel.length > 32 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(channel)))
    throw new Error("--workbench-channel requires --workbench-test and a lowercase name of up to 32 letters, digits and hyphens.");
  if ((!workbenchTest !== !testHome) || (workbenchTest && universalRoot))
    throw new Error("--workbench-test and --home are used together for a local test package.");
  if (testHome && !isAbsolute(testHome))
    throw new Error("--home must be an absolute content library path.");
  if ((remoteUrl || options.has("--chatgpt-app")) && !universalRoot)
    throw new Error("--remote-url and --chatgpt-app require --marketplace-root.");
  const marketplaceRoot = resolve(workbenchTest ?? universalRoot ?? root);
  const marketFile = join(marketplaceRoot, ".agents/plugins/marketplace.json");
  const initial = await optionalJson(marketFile);
  const legacyRemote = initial ? initial.name === "renaissance-mind-cloud" : !!remoteUrl;
  const universalName = legacyRemote ? "showai-cloud" : "showai-universal";
  const universalMarket = legacyRemote ? "renaissance-mind-cloud" : "renaissance-mind-universal";
  const pluginName = workbenchTest ? workbenchTestName : universalRoot ? universalName : "showai";
  const pluginRoot = join(marketplaceRoot, "plugins", universalRoot || workbenchTest ? pluginName : "showai-codex");
  const marketName = workbenchTest ? workbenchTestName : universalRoot ? universalMarket : initial?.name;
  if (typeof marketName !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(marketName))
    throw new Error("Expected a local marketplace with a valid name.");
  if (initial && (universalRoot || workbenchTest) &&
      (initial.name !== marketName || initial.plugins?.length !== 1 ||
        initial.plugins[0].name !== pluginName || initial.plugins[0].source?.source !== "local" ||
        resolve(marketplaceRoot, initial.plugins[0].source.path) !== pluginRoot))
    throw new Error(`Choose a dedicated directory for ${marketName}; the existing marketplace has other entries.`);
  const canonicalRoot = await realpath(marketplaceRoot).catch((error) => {
    if (error.code === "ENOENT") return marketplaceRoot;
    throw error;
  });
  const considered = await codex(["marketplace", "list"]);
  if (!Array.isArray(considered.marketplaces))
    throw new Error(
      "Codex returned an unrecognized marketplace list. Update Codex CLI and retry.",
    );
  for (const existing of considered.marketplaces.filter(
    (item) => item.name === marketName,
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
        `Marketplace ${marketName} already points to another source (${existing.root ?? "unknown"}). Choose a distinct marketplace or test channel.`,
      );
  }

  if (workbenchTest) await checkTestServer(join(marketplaceRoot, "agent-runtime.json"));
  if (universalRoot) {
    await assertPackageTarget(pluginRoot, pluginName);
    await mkdir(dirname(pluginRoot), { recursive: true });
    const staging = await mkdtemp(join(dirname(pluginRoot), ".remote-"));
    const prepared = join(staging, "new");
    try {
      await command(process.execPath, [
        join(root, "scripts/package-plugin.mjs"),
        ...(remoteUrl ? ["--mcp-url", remoteUrl] : []),
        "--out", prepared, "--name", pluginName,
        ...(options.has("--chatgpt-app") ? ["--chatgpt-app", options.get("--chatgpt-app")] : []),
      ]);
      await publishPluginDirectory(prepared, pluginRoot);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    await mkdir(join(marketplaceRoot, ".agents/plugins"), { recursive: true });
    await writeJson(
      join(marketplaceRoot, ".agents/plugins/marketplace.json"),
        {
          name: marketName,
          interface: { displayName: "ShowAI Universal" },
          plugins: [
            {
              name: pluginName,
              source: { source: "local", path: `./plugins/${pluginName}` },
              policy: { installation: "AVAILABLE", authentication: "ON_USE" },
              category: "Productivity",
            },
          ],
        },
    );
  }

  let workbenchBinding;
  if (workbenchTest) {
    await command(process.execPath, [join(root, "scripts/package-plugin.mjs")]);
    workbenchBinding = await stageWorkbenchTest(marketplaceRoot, pluginRoot, testHome);
  }
  const marketplace = JSON.parse(
    await readFile(
      join(marketplaceRoot, ".agents/plugins/marketplace.json"),
      "utf8",
    ),
  );
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(marketplace.name))
    throw new Error("Invalid local marketplace name.");
  const entry = marketplace.plugins?.find((item) => item.name === pluginName);
  if (
    entry?.source?.source !== "local" ||
    resolve(marketplaceRoot, entry.source.path) !== pluginRoot
  )
    throw new Error(
      `The marketplace must point at the generated ${pluginName} package (${pluginRoot}).`,
    );
  const identity = `${pluginName}@${marketplace.name}`;

  if (!universalRoot && !workbenchTest) {
    log("Preparing the ShowAI skills…");
    const packaged = await command(process.execPath, [join(root, "scripts/package-plugin.mjs")]);
    if (packaged.stdout.trim()) log(packaged.stdout.trim());
    if (packaged.stderr.trim()) process.stderr.write(packaged.stderr);
  }
  const manifest = JSON.parse(
    await readFile(join(pluginRoot, "plugin.json"), "utf8"),
  );
  if (manifest.name !== pluginName)
    throw new Error(`The packaged plugin is not ${pluginName}.`);
  const expected = await fingerprint(pluginRoot);

  log(`Registering the local marketplace and refreshing ${identity}…`);
  await codex(["marketplace", "add", marketplaceRoot]);
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
  const registeredMcp = workbenchTest ? await verifyWorkbenchTestServer(installedPath) : undefined;
  const receiptPath = universalRoot || workbenchTest
    ? join(marketplaceRoot, "codex-plugin-install.json")
    : join(root, "artifacts/codex-plugin-install.json");
  const receipt = {
    ok: true,
    action: flags.has("--update") ? "update" : "install",
    pluginId: identity,
    version: manifest.version,
    enabled: true,
    marketplaceRoot,
    ...(workbenchBinding ? { ...workbenchBinding, registeredMcp } : {}),
    ...(universalRoot
      ? { connectionMode: "manual", ...(remoteUrl && { mcpUrl: remoteUrl }), chatgptApp: options.get("--chatgpt-app") ?? null }
      : {}),
    sourcePath: pluginRoot,
    installedPath,
    verifiedFiles: actual.files,
    treeSha256: actual.treeSha256,
    files: Object.fromEntries(
      [
        "plugin.json",
        "skills/use-showai/SKILL.md",
        "skills/show-document/SKILL.md",
        "skills/create-component/SKILL.md",
        "skills/create-template/SKILL.md",
      ].map((path) => [path, actual.entries.get(path)?.sha256]),
    ),
    verifiedAt: new Date().toISOString(),
    receiptPath,
  };
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeJson(receiptPath, receipt);
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

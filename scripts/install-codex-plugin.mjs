#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  cp,
  lstat,
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

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = new Map();
const flags = new Set();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (["--remote-url", "--marketplace-root", "--chatgpt-app", "--workbench-test", "--home"].includes(arg)) {
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

async function npmScript(name) {
  const result = process.env.npm_execpath
    ? await command(process.execPath, [process.env.npm_execpath, "run", name])
    : await command("npm", ["run", name]);
  if (result.stdout.trim()) log(result.stdout.trim());
  if (result.stderr.trim()) process.stderr.write(result.stderr);
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

const workbenchTestName = "showai-workbench-test";
const workbenchTestServer = "showai_workbench_test";

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
  const current = await readFile(marketplace, "utf8").then(JSON.parse, (error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (current && current.name !== workbenchTestName)
    throw new Error("Choose a separate directory for the workbench test marketplace.");
  const previous = await readFile(join(pluginRoot, "plugin.json"), "utf8").then(JSON.parse, (error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (previous && previous.name !== workbenchTestName)
    throw new Error("The test package directory belongs to another plugin.");
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
  if (previous) await rm(pluginRoot, { recursive: true });
  await cp(join(root, "plugins/showai-codex"), pluginRoot, { recursive: true });

  const binding = join(marketplaceRoot, "agent-runtime.json");
  const env = {
    SHOWAI_HOME: library,
    SHOWAI_CODEX_WORKBENCH_PROFILE: join(marketplaceRoot, "profile"),
  };
  const launch = { command: process.execPath, args: [cli], env };
  const runtime = JSON.parse(await readFile(join(runtimeRoot, "assets/build.json"), "utf8"));
  await writeFile(binding, JSON.stringify({
    format: "showai-agent-runtime", protocol: 1, channel: "development",
    version: runtime.version, home: library, launch, registeredAt: new Date().toISOString(),
  }, null, 2) + "\n", { mode: 0o600 });

  const mcpPath = join(pluginRoot, "mcp.json");
  const mcp = JSON.parse(await readFile(mcpPath, "utf8"));
  const server = mcp.mcpServers.showai;
  server.command = await writeWorkbenchTestLauncher(pluginRoot);
  server.args = [];
  Object.assign(server.env, env, { SHOWAI_RUNTIME_CONFIG: binding });
  mcp.mcpServers = { [workbenchTestServer]: server };
  await writeFile(mcpPath, JSON.stringify(mcp, null, 2) + "\n");

  const manifestPath = join(pluginRoot, "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const runtimeHash = createHash("sha256")
    .update(await readFile(cli))
    .update((await fingerprint(pluginRoot)).treeSha256)
    .digest("hex")
    .slice(0, 12);
  manifest.name = workbenchTestName;
  manifest.version = `${manifest.version.split("+")[0]}+workbench.${runtimeHash}`;
  manifest.extensions["com.openai"].interface.displayName = "ShowAI Workbench Test";
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  await mkdir(dirname(marketplace), { recursive: true });
  await writeFile(marketplace, JSON.stringify({
    name: workbenchTestName,
    interface: { displayName: "ShowAI Workbench Test" },
    plugins: [{
      name: workbenchTestName,
      source: { source: "local", path: "./plugins/showai-workbench-test" },
      policy: { installation: "AVAILABLE", authentication: "ON_USE" },
      category: "Productivity",
    }],
  }, null, 2) + "\n");
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
       !legacyLauncher.includes("/showai-workbench-test/showai-workbench-test/") ||
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
      "Usage: node scripts/install-codex-plugin.mjs [--update] [--json]\n       node scripts/install-codex-plugin.mjs --remote-url HTTPS_MCP_URL --marketplace-root DIRECTORY [--chatgpt-app asdk_app_ID] [--update] [--json]\nValidates the MCP plugin, then uses official Codex commands to install or refresh it. The remote form generates showai-cloud in its own marketplace. Use --workbench-test DIRECTORY --home LIBRARY with a built checkout to install the separately named interactive workbench test. The ShowAI software runtime is installed separately. Verifies installed bytes and enabled status.",
    );
    return;
  }
  const remoteUrl = options.get("--remote-url");
  const workbenchTest = options.get("--workbench-test");
  const testHome = options.get("--home");
  if ((!workbenchTest !== !testHome) || (workbenchTest && remoteUrl))
    throw new Error("--workbench-test and --home are used together for a local test package.");
  if (testHome && !isAbsolute(testHome))
    throw new Error("--home must be an absolute content library path.");
  if (!remoteUrl !== !options.get("--marketplace-root"))
    throw new Error("--remote-url and --marketplace-root are used together.");
  if (options.get("--chatgpt-app") && !remoteUrl)
    throw new Error("--chatgpt-app applies to the remote plugin.");
  const marketplaceRoot = workbenchTest
    ? resolve(workbenchTest)
    : remoteUrl ? resolve(options.get("--marketplace-root")) : root;
  const pluginName = workbenchTest ? workbenchTestName : remoteUrl ? "showai-cloud" : "showai";
  const pluginRoot = join(marketplaceRoot, "plugins", remoteUrl || workbenchTest ? pluginName : "showai-codex");
  if (remoteUrl) {
    const previous = await readFile(
      join(pluginRoot, "plugin.json"),
      "utf8",
    ).then(
      (text) => JSON.parse(text).name,
      (error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (previous !== undefined && previous !== "showai-cloud")
      throw new Error(
        `${pluginRoot} holds another plugin; nothing was changed.`,
      );
    if (previous) await rm(pluginRoot, { recursive: true });
    await mkdir(dirname(pluginRoot), { recursive: true });
    await mkdir(join(marketplaceRoot, ".agents/plugins"), { recursive: true });
    await writeFile(
      join(marketplaceRoot, ".agents/plugins/marketplace.json"),
      JSON.stringify(
        {
          name: "renaissance-mind-cloud",
          interface: { displayName: "Renaissance Mind Cloud" },
          plugins: [
            {
              name: "showai-cloud",
              source: { source: "local", path: "./plugins/showai-cloud" },
              policy: { installation: "AVAILABLE", authentication: "ON_USE" },
              category: "Productivity",
            },
          ],
        },
        null,
        2,
      ) + "\n",
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
  const canonicalRoot = await realpath(marketplaceRoot);

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
    ...(remoteUrl
      ? [
          "--mcp-url",
          remoteUrl,
          "--out",
          pluginRoot,
          "--name",
          pluginName,
          ...(options.get("--chatgpt-app")
            ? ["--chatgpt-app", options.get("--chatgpt-app")]
            : []),
        ]
      : []),
  ]);
  if (packaged.stdout.trim()) log(packaged.stdout.trim());
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
  const receiptPath = remoteUrl || workbenchTest
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
    ...(remoteUrl
      ? { mcpUrl: remoteUrl, chatgptApp: options.get("--chatgpt-app") ?? null }
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

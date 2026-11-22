import { constants } from "node:fs";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  execute,
  executablePaths,
  findExecutable,
} from "../agent-host/process";
import { withLibraryLock } from "../core/library-lock";
import type { RuntimeLaunch } from "../agent/runtime";
import { publishPluginDirectory } from "./host-package.mjs";
import {
  prepareLocalPlugin,
  type LocalPluginPackageOptions,
} from "./local-plugin-package";
import { PluginInstallError } from "./plugin-errors";

const localHosts = [
  "cursor",
  "cursor-ide",
  "trae",
  "workbuddy",
  "gemini",
] as const;
export type LocalInstallHost = (typeof localHosts)[number];
export type LocalInstallReceipt = {
  host: LocalInstallHost;
  home: string;
  next?: "cursor-reload" | "trae-mcp" | "trae-confirm";
  approvalUrl?: string;
};

const workbenchId = "renaissancemind.showai-workbench";
const workBuddyMarket = "showai-workbuddy-local";
const workBuddyId = "showai-workbuddy@" + workBuddyMarket;

async function readJson(path: string): Promise<unknown> {
  return readFile(path, "utf8").then(
    JSON.parse,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
}

async function available(path: string, mode = constants.F_OK) {
  return access(path, mode).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (
        error.code === "ENOENT" ||
        error.code === "EACCES" ||
        error.code === "ENOTDIR"
      )
        return false;
      throw error;
    },
  );
}

async function editorCli(
  editor: "cursor" | "trae",
): Promise<RuntimeLaunch | undefined> {
  const appNames = editor === "cursor" ? ["Cursor"] : ["Trae CN", "Trae"];
  if (process.platform === "darwin") {
    for (const root of ["/Applications", join(homedir(), "Applications")])
      for (const app of appNames) {
        const command = join(
          root,
          app + ".app",
          "Contents/Resources/app/bin",
          editor,
        );
        if (await available(command, constants.X_OK))
          return { command, args: [], env: {} };
      }
  }
  const names = editor === "trae" ? ["trae", "trae-cn"] : [editor];
  const shortcuts = await Promise.all(names.map(findExecutable));
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    for (const app of appNames) {
      const shim = join(
        process.env.LOCALAPPDATA,
        "Programs",
        app,
        "bin",
        editor + ".cmd",
      );
      if (await available(shim)) shortcuts.push(shim);
    }
  }
  for (const binary of shortcuts) {
    if (!binary) continue;
    if (process.platform !== "win32")
      return { command: await realpath(binary), args: [], env: {} };
    if (!/\.(cmd|bat)$/i.test(binary))
      return { command: binary, args: [], env: {} };
    const root = dirname(dirname(binary));
    const cli = join(root, "resources/app/out/cli.js");
    for (const app of appNames) {
      const command = join(root, app + ".exe");
      if ((await available(command)) && (await available(cli)))
        return { command, args: [cli], env: { ELECTRON_RUN_AS_NODE: "1" } };
    }
  }
}

async function workBuddyCli(): Promise<string | undefined> {
  const apps =
    process.platform === "darwin"
      ? [
          "/Applications/WorkBuddy.app/Contents/Resources",
          join(homedir(), "Applications/WorkBuddy.app/Contents/Resources"),
        ]
      : process.platform === "win32" && process.env.LOCALAPPDATA
        ? [join(process.env.LOCALAPPDATA, "Programs/WorkBuddy/resources")]
        : [];
  for (const root of apps) {
    const script = join(
      root,
      "app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs",
    );
    if (await available(script)) return script;
  }
}

export async function localInstallHosts() {
  const [cursor, agent, trae, workBuddy, gemini] = await Promise.all([
    editorCli("cursor"),
    findExecutable("cursor-agent"),
    editorCli("trae"),
    workBuddyCli(),
    findExecutable("gemini"),
  ]);
  return [
    ...(cursor || agent ? ["cursor" as const] : []),
    ...(cursor ? ["cursor-ide" as const] : []),
    ...(trae ? ["trae" as const] : []),
    ...(workBuddy ? ["workbuddy" as const] : []),
    ...(gemini ? ["gemini" as const] : []),
  ];
}

async function command(launcher: RuntimeLaunch, args: string[], cwd: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: executablePaths().join(delimiter),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = await execute(launcher.command, [...launcher.args, ...args], {
    cwd,
    env: { ...env, ...launcher.env },
    timeout: 60_000,
  });
  if (result.code !== 0) {
    throw new PluginInstallError(
      "PLUGIN_HOST_COMMAND_FAILED",
      "The host installation command failed.",
      {
        exitCode: result.code,
        output: (result.stderr || result.stdout).trim().slice(-2400),
      },
    );
  }
  return result.stdout;
}

function missing(host: LocalInstallHost): never {
  throw new PluginInstallError(
    "PLUGIN_HOST_MISSING",
    "The host's local installer is unavailable.",
    { host },
  );
}

function packageOwned(path: unknown, root: string, name: string) {
  if (typeof path !== "string" || !isAbsolute(path)) return false;
  const [folder, key, target, ...rest] = relative(root, path).split(sep);
  return (
    folder === "packages" &&
    /^[a-f0-9]{16}$/.test(key) &&
    target === name &&
    !rest.length
  );
}

export async function installCursorAgent(
  source: string,
  local: string,
  root: string,
) {
  const name = "showai-cursor";
  const target = join(local, name);
  const current = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (current) {
    if (!current.isDirectory())
      throw new PluginInstallError(
        "PLUGIN_OTHER_SOURCE",
        "Another source owns this Cursor plugin directory.",
      );
    const config = (await readJson(join(target, "mcp.json"))) as
      | { mcpServers?: Record<string, { env?: Record<string, string> }> }
      | undefined;
    const binding = config?.mcpServers?.[name]?.env?.SHOWAI_RUNTIME_CONFIG;
    if (!packageOwned(binding, root, "agent-runtime.json"))
      throw new PluginInstallError(
        "PLUGIN_OTHER_SOURCE",
        "Another source owns this Cursor plugin directory.",
      );
  }
  await mkdir(local, { recursive: true });
  const staging = await mkdtemp(join(dirname(local), ".showai-install-"));
  try {
    await cp(source, staging, { recursive: true });
    await publishPluginDirectory(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function installWorkbench(
  host: "cursor-ide" | "trae",
  options: LocalPluginPackageOptions,
) {
  const launcher = await editorCli(host === "trae" ? "trae" : "cursor");
  if (!launcher) missing(host);
  const { path } = await prepareLocalPlugin(host, options);
  await installIdeExtension(launcher, path, options.root);
  return launcher;
}

export async function installIdeExtension(
  launcher: RuntimeLaunch,
  archive: string,
  cwd: string,
) {
  await command(launcher, ["--install-extension", archive, "--force"], cwd);
  const installed = await command(launcher, ["--list-extensions"], cwd);
  if (
    !installed
      .split(/\r?\n/)
      .some((line) => line.trim().toLowerCase() === workbenchId)
  )
    throw new PluginInstallError(
      "PLUGIN_NOT_CONFIRMED",
      "The editor did not list ShowAI Workbench after installation.",
    );
}

function traeApprovalLink(launcher: RuntimeLaunch, launch: RuntimeLaunch) {
  const source = [launcher.command, ...launcher.args].join(" ");
  if (
    !/(?:^|[\\/])(?:trae cn|trae-cn)(?:\.app|\.exe|$)/i.test(source) &&
    basename(launcher.command) !== "trae-cn"
  )
    return;
  const config =
    process.platform === "win32"
      ? launch
      : {
          command: "/usr/bin/env",
          args: [
            ...Object.entries(launch.env).map(
              ([key, value]) => key + "=" + value,
            ),
            launch.command,
            ...launch.args,
          ],
        };
  return (
    "trae-cn://trae.ai-ide/mcp-import?" +
    new URLSearchParams({
      type: "stdio",
      name: "showai",
      config: Buffer.from(JSON.stringify(config)).toString("base64"),
    })
  );
}

async function installWorkBuddy(options: LocalPluginPackageOptions) {
  const script = await workBuddyCli();
  if (!script) missing("workbuddy");
  const { cli } = options.runtime();
  const launcher = {
    command: cli.command,
    args: [script],
    env: {
      ...cli.env,
      CODEBUDDY_CONFIG_DIR:
        process.env.CODEBUDDY_CONFIG_DIR || join(homedir(), ".workbuddy"),
    },
  };
  const run = (...args: string[]) =>
    command(launcher, ["plugin", ...args], options.root);
  const { path } = await prepareLocalPlugin("workbuddy", options);
  const markets = JSON.parse(await run("marketplace", "list")) as {
    name: string;
    type: string;
    description?: string;
  }[];
  const current = markets.find((item) => item.name === workBuddyMarket);
  const source =
    current?.type === "directory"
      ? current.description?.match(/^Marketplace from (.+)$/)?.[1]
      : undefined;
  if (
    current &&
    source !== path &&
    !packageOwned(source, options.root, "showai-workbuddy")
  )
    throw new PluginInstallError(
      "PLUGIN_MARKETPLACE_CONFLICT",
      "Another WorkBuddy marketplace has this name.",
    );
  await run("marketplace", "add", path);
  const list = async () =>
    JSON.parse(await run("list", "--json")) as {
      id: string;
      scope: string;
      enabled: boolean;
      installPath?: string;
    }[];
  const installed = () =>
    list().then((items) =>
      items.find((item) => item.id === workBuddyId && item.scope === "user"),
    );
  await run((await installed()) ? "update" : "install", workBuddyId);
  let state = await installed();
  if (state && !state.enabled) {
    await run("enable", workBuddyId);
    state = await installed();
  }
  if (!state?.enabled || !state.installPath || !isAbsolute(state.installPath))
    throw new PluginInstallError(
      "PLUGIN_NOT_CONFIRMED",
      "WorkBuddy did not confirm the ShowAI installation.",
    );
  const expected = await readJson(join(path, ".mcp.json"));
  const actual = await readJson(join(state.installPath, ".mcp.json"));
  if (!isDeepStrictEqual(actual, expected))
    throw new PluginInstallError(
      "PLUGIN_FILES_MISMATCH",
      "WorkBuddy did not install the MCP configuration for this library.",
    );
}

async function configureGemini(
  options: LocalPluginPackageOptions,
  launch: RuntimeLaunch,
) {
  const executable = await findExecutable("gemini");
  if (!executable) missing("gemini");
  const settings = join(
    process.env.GEMINI_CLI_HOME || homedir(),
    ".gemini/settings.json",
  );
  const read = async () =>
    (
      (await readJson(settings)) as
        { mcpServers?: Record<string, RuntimeLaunch> } | undefined
    )?.mcpServers?.showai;
  const existing = await read();
  if (
    existing &&
    (!Array.isArray(existing.args) ||
      existing.args.length !== 1 ||
      (!/(?:^|[\\/])agent-plugin[\\/]mcp[\\/]launch\.mjs$/.test(
        existing.args[0],
      ) &&
        existing.args[0] !== launch.args[0]))
  )
    throw new PluginInstallError(
      "PLUGIN_OTHER_SOURCE",
      "Gemini already uses the name showai for another MCP connection.",
    );
  const env = { ...launch.env, SHOWAI_LINKED_WORKBENCH: "1" };
  await command(
    { command: executable, args: [], env: {} },
    [
      "mcp",
      "add",
      "--scope",
      "user",
      ...Object.entries(env).map(([key, value]) => `--env=${key}=${value}`),
      "showai",
      launch.command,
      ...launch.args,
    ],
    options.root,
  );
  const configured = await read();
  if (
    configured?.command !== launch.command ||
    !isDeepStrictEqual(configured.args, launch.args) ||
    !isDeepStrictEqual(configured.env, env)
  )
    throw new PluginInstallError(
      "PLUGIN_NOT_CONFIRMED",
      "Gemini did not save the ShowAI MCP configuration.",
    );
}

export async function installLocalAgent(
  input: unknown,
  options: LocalPluginPackageOptions,
): Promise<LocalInstallReceipt> {
  if (!localHosts.includes(input as LocalInstallHost))
    throw new PluginInstallError(
      "PLUGIN_UNKNOWN_HOST",
      "Unknown local plugin host.",
    );
  const host = input as LocalInstallHost;
  const runtime = options.runtime();
  const bound = { ...options, runtime: () => runtime };
  await mkdir(options.root, { recursive: true });
  return withLibraryLock(
    options.root,
    async () => {
      const receipt = { host, home: runtime.home };
      const launch = {
        command: runtime.cli.command,
        args: [resolve(options.pluginRoot(), "mcp/launch.mjs")],
        env: { ...runtime.cli.env, SHOWAI_HOME: runtime.home },
      };
      if (host === "cursor") {
        if (
          !(await editorCli("cursor")) &&
          !(await findExecutable("cursor-agent"))
        )
          missing(host);
        const { path } = await prepareLocalPlugin(host, bound);
        await installCursorAgent(
          path,
          join(homedir(), ".cursor/plugins/local"),
          options.root,
        );
        return { ...receipt, next: "cursor-reload" };
      } else if (host === "trae" || host === "cursor-ide") {
        const launcher = await installWorkbench(host, bound);
        if (host === "trae") {
          const approvalUrl = traeApprovalLink(launcher, {
            ...launch,
            env: {
              ...launch.env,
              SHOWAI_HOST_DISPLAY: "fragment-file",
              SHOWAI_LINKED_WORKBENCH: "1",
              SHOWAI_LOCAL_PAGE_REFERENCES: "1",
            },
          });
          return {
            ...receipt,
            next: "trae-mcp",
            ...(approvalUrl && { approvalUrl }),
          };
        }
      } else if (host === "workbuddy") {
        await installWorkBuddy(bound);
      } else {
        await configureGemini(bound, launch);
      }
      return receipt;
    },
    "install-local-plugins",
  );
}

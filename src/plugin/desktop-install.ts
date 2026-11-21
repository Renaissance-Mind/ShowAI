import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  execute,
  executablePaths,
  findExecutable,
  RpcProcess,
} from "../agent-host/process";
import { AgentFailure } from "../agent-host/problems";
import {
  registerRuntime,
  runtimeRegistrationStatus,
  writeRuntimeRecord,
  type RuntimeChannel,
  type RuntimeLaunch,
} from "../agent/runtime";
import { PluginInstallError, VERIFIED_HOST_VERSIONS } from "./plugin-errors";
import {
  bindHostSkills,
  ANTIGRAVITY_EAGER_TOOLS,
  HOST_PROFILES,
  writeAntigravityAssets,
  writeHostLauncher,
  publishPluginDirectory,
} from "./host-package.mjs";
import {
  DSH_BUNDLE_FILES,
  inspectDshProfile,
  stageDshBundle,
  type DshProfileState,
} from "./dsh-stage.mjs";

export type PluginHost = "codex" | "claude" | "antigravity" | "deepseek";
export interface DshPendingSteps {
  bundlePath: string;
  profileMissing: boolean;
  otherSource?: string;
  legacyBundles: string[];
  manualMcpRow?: string;
  shadowingSkills: string[];
  skillRoot: string;
  add: boolean;
  enable: boolean;
}
export interface PluginInstallation {
  host: PluginHost;
  executable: string | null;
  installed: boolean;
  enabled: boolean;
  version?: string;
  current?: boolean;
  expected?: string;
  installedPath?: string;
  otherSources: string[];
  error?: string;
  errorCode?: string;
  boundHome?: string;
  searched?: string[];
  manualPath?: string;
  dsh?: DshPendingSteps;
}
export interface PluginInstallReceipt {
  host: PluginHost;
  version: string;
  installedPath: string;
  verifiedFiles: number;
  treeSha256: string;
  home: string;
  dsh?: DshPendingSteps;
}

interface CodexInstalledPlugin {
  id: string;
  installed: boolean;
  enabled: boolean;
  localVersion?: string | null;
}

const marketplaceName = "showai-desktop";
const STATUS_TIMEOUT = 15000;
const identity = `showai@${marketplaceName}`;
export const desktopPluginActions = new Set([
  "plugins:status",
  "plugins:install",
  "plugins:runtime",
  "plugins:repairRuntime",
  "plugins:setPath",
  "plugins:launchConfig",
]);

export function pluginInstallerAction(
  installer: DesktopPluginInstaller,
  action: string,
  args: Record<string, unknown>,
) {
  switch (action) {
    case "plugins:status":
      return installer.status(
        args.host === undefined ? undefined : pluginHost(args.host),
      );
    case "plugins:install":
      return installer.install(args.host);
    case "plugins:runtime":
      return installer.runtimeStatus();
    case "plugins:repairRuntime":
      return installer.repairRuntime();
    case "plugins:setPath":
      return installer.setPath(args);
    case "plugins:launchConfig":
      return installer.launchConfig();
    default:
      throw new PluginInstallError(
        "PLUGIN_UNKNOWN_HOST",
        `Unknown plugin action: ${action}`,
      );
  }
}

async function fileHashes(root: string) {
  const files: [string, string][] = [];
  async function visit(directory: string, prefix = "") {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      const name = prefix + entry.name;
      if (entry.isDirectory()) await visit(path, name + "/");
      else if (entry.isFile())
        files.push([
          name,
          createHash("sha256")
            .update(await readFile(path))
            .digest("hex"),
        ]);
      else
        throw new PluginInstallError(
          "PLUGIN_BUNDLE_INVALID",
          `Unsupported plugin file: ${name}`,
        );
    }
  }
  await visit(root);
  return files;
}

function fingerprint(files: [string, string][]) {
  return {
    verifiedFiles: files.length,
    treeSha256: createHash("sha256")
      .update(JSON.stringify(files))
      .digest("hex"),
  };
}

export async function pluginFingerprint(root: string) {
  return fingerprint(await fileHashes(root));
}

function hostFiles(host: PluginHost, files: [string, string][]) {
  return files.filter(([name]) => {
    if (name.startsWith("host-adapters/"))
      return (
        name === `host-adapters/${host}.md` ||
        (host === "codex" &&
          [
            "host-adapters/codex-entry.md",
            "host-adapters/launch.mjs.in",
          ].includes(name)) ||
        (host === "antigravity" &&
          (name === "host-adapters/antigravity-entry.md" ||
            name.startsWith("host-adapters/antigravity/")))
      );
    if (name === "skills/use-showai/references/host-adapter.md") return false;
    if (host === "deepseek")
      return name.startsWith("skills/") || name === "mcp/launch.mjs";
    if (name.startsWith(".claude-plugin/")) return host === "claude";
    if (name === "mcp.json" || name === ".mcp.json") return false;
    return host !== "codex" || name !== "mcp/launch.mjs";
  });
}

async function exists(path: string, mode = constants.F_OK) {
  return access(path, mode).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "EACCES") return false;
      throw error;
    },
  );
}

async function dshApplication() {
  if (process.platform === "darwin")
    for (const root of ["/Applications", join(homedir(), "Applications")]) {
      const path = join(root, "DeepSeek Harness.app");
      if (await exists(path)) return path;
    }
  const cli = await findExecutable("dsh");
  if (cli) return cli;
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return (await exists(join(home, "profiles/desktop/package.json")))
    ? home
    : null;
}

function dshSteps(path: string, state: DshProfileState): DshPendingSteps {
  return {
    bundlePath: path,
    profileMissing: !state.profileFound,
    otherSource: state.otherSource,
    legacyBundles: state.legacyBundles,
    manualMcpRow: state.manualMcpRow
      ? join(state.profile, "cordis.patch.yml")
      : undefined,
    shadowingSkills: state.shadowingSkills,
    skillRoot: join(state.home, "skills"),
    add: !state.installed,
    enable: state.installed && !state.enabled,
  };
}

function launcherScript(server: { command: string; args: string[] }) {
  const words = [server.command, ...server.args];
  if (process.platform === "win32") {
    const line = words.map((word) => `"${word}"`).join(" ");
    return { name: "showai-mcp.cmd", text: `@echo off\r\n${line} %*\r\n` };
  }
  const line = words
    .map((word) => `'${word.replaceAll("'", `'\\''`)}'`)
    .join(" ");
  return { name: "showai-mcp", text: `#!/bin/sh\nexec ${line} "$@"\n` };
}

export async function hostExecutable(host: PluginHost) {
  if (host === "deepseek") return dshApplication();
  const binary = host === "antigravity" ? "agy" : host;
  const executable = await findExecutable(binary);
  if (executable || host !== "codex" || process.platform !== "darwin")
    return executable;
  for (const root of ["/Applications", join(homedir(), "Applications")]) {
    for (const relative of [
      "Codex.app/Contents/Resources/codex",
      "Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
      "ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    ]) {
      const path = join(root, relative);
      if (await exists(path, constants.X_OK)) return path;
    }
  }
  return null;
}

export const PLUGIN_HOSTS = [
  "codex",
  "claude",
  "antigravity",
  "deepseek",
] as const;
function pluginHost(value: unknown): PluginHost {
  if (!PLUGIN_HOSTS.includes(value as PluginHost))
    throw new PluginInstallError("PLUGIN_UNKNOWN_HOST", "Unknown plugin host.");
  return value as PluginHost;
}

export class DesktopPluginInstaller {
  private pending = false;
  constructor(
    private options: {
      root: string;
      pluginRoot: () => string;
      dshBundleRoot: () => string;
      runtime: () => { home: string; cli: RuntimeLaunch };
      channel: RuntimeChannel;
    },
  ) {}

  private manualPaths(): Promise<Partial<Record<PluginHost, string>>> {
    return readFile(join(this.options.root, "host-paths.json"), "utf8").then(
      (text) => JSON.parse(text) as Partial<Record<PluginHost, string>>,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return {};
        throw error;
      },
    );
  }

  private async hostExecutable(host: PluginHost) {
    const manual = (await this.manualPaths())[host];
    if (manual && (await exists(manual, constants.X_OK))) return manual;
    return hostExecutable(host);
  }

  async setPath(input: Record<string, unknown>) {
    const host = pluginHost(input.host);
    const path = typeof input.path === "string" ? input.path.trim() : "";
    if (path && (!isAbsolute(path) || !(await exists(path, constants.X_OK))))
      throw new PluginInstallError(
        "PLUGIN_PATH_INVALID",
        "Choose an existing executable by its absolute path.",
        { path },
      );
    const paths = await this.manualPaths();
    if (path) paths[host] = resolve(path);
    else delete paths[host];
    await mkdir(this.options.root, { recursive: true });
    const target = join(this.options.root, "host-paths.json");
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(paths, null, 2) + "\n");
    await rename(temporary, target);
    return this.status();
  }

  runtimeStatus() {
    const runtime = this.options.runtime();
    return runtimeRegistrationStatus(
      runtime.home,
      runtime.cli,
      this.options.channel,
    );
  }

  async repairRuntime() {
    const runtime = this.options.runtime();
    await registerRuntime(runtime.home, runtime.cli, this.options.channel);
    return this.runtimeStatus();
  }

  launchConfig() {
    const runtime = this.options.runtime();
    return {
      command: runtime.cli.command,
      args: [join(this.options.pluginRoot(), "mcp/launch.mjs")],
      env: { ...runtime.cli.env, SHOWAI_HOME: runtime.home },
    };
  }

  private commandEnv(executable: string) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: executablePaths().join(delimiter),
      ...(process.env.AGY_HOME &&
      /(?:^|[\\/])agy(?:\.(?:exe|cmd|bat))?$/i.test(executable)
        ? { HOME: process.env.AGY_HOME }
        : {}),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
  }

  private commandTimeout(command: string, timeout: number) {
    return new PluginInstallError(
      "PLUGIN_HOST_COMMAND_TIMEOUT",
      `${command} timed out after ${timeout / 1000} seconds.`,
      { command, timeoutMs: timeout },
    );
  }

  private async command(executable: string, args: string[], timeout = 120000) {
    const result = await execute(executable, ["plugin", ...args], {
      env: this.commandEnv(executable),
      cwd: this.options.root,
      timeout,
    }).catch((error) => {
      if (error instanceof AgentFailure && error.problem.code === "timeout")
        throw this.commandTimeout(`${executable} plugin ${args.join(" ")}`, timeout);
      throw error;
    });
    if (result.code !== 0)
      throw new PluginInstallError(
        "PLUGIN_HOST_COMMAND_FAILED",
        `${executable} plugin ${args.join(" ")} exited ${result.code}.`,
        {
          command: ["plugin", ...args].join(" "),
          exitCode: result.code,
          output: (result.stderr || result.stdout).trim().slice(-8000),
        },
      );
    return result.stdout;
  }

  private async listJson(
    host: "codex" | "claude" | "antigravity",
    executable: string,
    args: string[],
    timeout?: number,
  ) {
    const output = await this.command(executable, args, timeout);
    try {
      return JSON.parse(output);
    } catch {
      throw this.tooOld(host, output);
    }
  }

  private tooOld(host: "codex" | "claude" | "antigravity", output: string) {
    const name =
      host === "codex"
        ? "Codex"
        : host === "claude"
          ? "Claude Code"
          : "Antigravity";
    return new PluginInstallError(
      "PLUGIN_HOST_TOO_OLD",
      `This ${name} does not report plugins as JSON; update it to ${VERIFIED_HOST_VERSIONS[host]} or later.`,
      {
        host,
        minimumVersion: VERIFIED_HOST_VERSIONS[host],
        output: output.trim().slice(-8000),
      },
    );
  }

  private dshTarget() {
    return join(this.options.root, "deepseek/showai");
  }

  private async inspectDsh(
    executable: string,
    expected?: Promise<string>,
  ): Promise<PluginInstallation> {
    const target = this.dshTarget();
    const optionalJson = <T>(path: string) =>
      readFile(path, "utf8").then(
        (text) => JSON.parse(text) as T,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        },
      );
    const staged = await optionalJson<{ version?: string }>(
      join(target, "package.json"),
    );
    const receipt = staged
      ? await optionalJson<{ version?: string; source?: string }>(
          join(this.options.root, "deepseek-install.json"),
        )
      : undefined;
    const source = expected ? await expected : undefined;
    const state = await inspectDshProfile({
      target,
      skillNames: await readdir(join(this.options.pluginRoot(), "skills")),
    });
    return {
      host: "deepseek",
      executable,
      installed: state.installed,
      enabled: state.enabled,
      version: staged?.version,
      current:
        staged && source
          ? receipt?.source === source && receipt.version === staged.version
          : undefined,
      expected: source,
      installedPath: staged ? target : undefined,
      otherSources: state.otherSource ? [state.otherSource] : [],
      dsh: dshSteps(target, state),
    };
  }

  private async packageSource() {
    const manifest = JSON.parse(
      await readFile(join(this.options.pluginRoot(), "plugin.json"), "utf8"),
    );
    if (manifest.name !== "showai" || typeof manifest.version !== "string")
      throw new PluginInstallError(
        "PLUGIN_BUNDLE_INVALID",
        "Invalid bundled ShowAI plugin.",
      );
    const files = await fileHashes(this.options.pluginRoot());
    const { home, cli } = this.options.runtime();
    return { manifest, files, runtime: { home, cli } };
  }

  private hostLaunch(
    host: Exclude<PluginHost, "deepseek">,
    runtime: { home: string; cli: RuntimeLaunch },
  ) {
    const bindingId = createHash("sha256")
      .update(JSON.stringify([this.options.channel, runtime.home, runtime.cli]))
      .digest("hex");
    const record = join(
      this.options.root,
      "runtimes",
      host,
      bindingId + ".json",
    );
    const env = {
      ...runtime.cli.env,
      SHOWAI_HOME: runtime.home,
      SHOWAI_RUNTIME_CONFIG: record,
      SHOWAI_HOST_DISPLAY: HOST_PROFILES[host],
      ...(host === "codex" && {
        SHOWAI_CODEX_PLUGIN_ID: identity,
        SHOWAI_CODEX_WORKBENCH_PROFILE: join(
          this.options.root,
          "codex-workbench",
        ),
      }),
    };
    const server = {
      command: runtime.cli.command,
      args: [join(this.options.root, host, "plugins/showai/mcp/launch.mjs")],
      env,
      ...(host === "antigravity" && { tools: ANTIGRAVITY_EAGER_TOOLS }),
    };
    if (host === "codex") {
      const launcher = launcherScript(server);
      return {
        record,
        launcher,
        filename: "mcp.json",
        config: {
          $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
          mcpServers: {
            showai: {
              type: "stdio",
              command: "./mcp/" + launcher.name,
              args: [],
              env,
            },
          },
        },
      };
    }
    return {
      record,
      filename: host === "claude" ? ".mcp.json" : "mcp_config.json",
      config: { mcpServers: { showai: server } },
    };
  }

  private async expectedVersion(
    host: PluginHost,
    source = this.packageSource(),
  ) {
    const { manifest, files, runtime } = await source;
    const inputs: unknown[] = [
      manifest.version,
      hostFiles(host, files),
      runtime,
    ];
    if (host === "deepseek") {
      inputs.push(
        await Promise.all(
          DSH_BUNDLE_FILES.map(async (name) => [
            name,
            createHash("sha256")
              .update(await readFile(join(this.options.dshBundleRoot(), name)))
              .digest("hex"),
          ]),
        ),
      );
    } else {
      inputs.push(this.hostLaunch(host, runtime));
    }
    const digest = createHash("sha256")
      .update(JSON.stringify(inputs))
      .digest("hex")
      .slice(0, 12);
    return host === "deepseek"
      ? digest
      : `${manifest.version}+desktop.${digest}`;
  }

  private async inspect(
    host: PluginHost,
    executable: string,
    expected?: Promise<string>,
  ): Promise<PluginInstallation> {
    if (host === "deepseek") return this.inspectDsh(executable, expected);
    const items = host === "codex"
      ? await this.codexInstalled(executable)
      : await this.listJson(host, executable, ["list", "--json"], STATUS_TIMEOUT);
    if (!Array.isArray(items)) throw this.tooOld(host, JSON.stringify(items));
    const receipt = await readFile(
      join(this.options.root, `${host}-install.json`),
      "utf8",
    ).then(
      (text) => JSON.parse(text) as { home?: unknown; version?: string },
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    const own =
      host === "antigravity"
        ? items.find(
            (item) =>
              item.name === "showai" &&
              typeof item.version === "string" &&
              item.version.includes("+desktop."),
          )
        : items.find(
            (item) =>
              (item.pluginId ?? item.id) === identity &&
              (host === "codex" || item.scope === "user"),
          );
    return {
      host,
      executable,
      installed: !!own && (host !== "codex" || own.installed === true),
      enabled: own?.enabled === true,
      version: own?.version,
      current: !!own?.version && !!expected && own.version === (await expected),
      expected: expected ? await expected : undefined,
      installedPath: own?.installedPath ?? own?.installPath ?? own?.path,
      ...(own &&
      receipt?.version === own.version &&
      typeof receipt?.home === "string"
        ? { boundHome: receipt.home }
        : {}),
      otherSources: items
        .filter((item) => {
          if (host === "antigravity") {
            return (
              typeof item.name === "string" &&
              (item.name === "showai" || item.name.startsWith("showai-")) &&
              item !== own &&
              item.enabled
            );
          }
          const id = item.pluginId ?? item.id;
          return (
            typeof id === "string" &&
            id.startsWith("showai@") &&
            id !== identity &&
            item.enabled
          );
        })
        .map((item) =>
          host === "antigravity"
            ? item.version
              ? `${item.name}@${item.version}`
              : item.name
            : (item.pluginId ?? item.id),
        ),
    };
  }

  private async codexInstalled(executable: string) {
    const controller = new AbortController();
    const rpc = new RpcProcess(
      executable, ["app-server", "--listen", "stdio://"], this.options.root,
      () => {}, controller.signal, { env: this.commandEnv(executable) },
    );
    const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT);
    try {
      await rpc.request("initialize", {
        clientInfo: { name: "showai-plugin-settings", version: "1" },
        capabilities: { experimentalApi: true },
      });
      rpc.send({ jsonrpc: "2.0", method: "initialized" });
      // This inventory includes other installed sources without refreshing remote catalogs.
      const data: { marketplaces: { plugins: CodexInstalledPlugin[] }[] } =
        await rpc.request("plugin/installed", { cwds: [this.options.root] });
      if (!Array.isArray(data?.marketplaces) || !data.marketplaces.every((m) => Array.isArray(m?.plugins)))
        throw this.tooOld("codex", "Invalid plugin/installed response.");
      return data.marketplaces.flatMap((m) => m.plugins)
        .filter((item) => item.installed === true)
        .map((item) => ({ ...item, version: item.localVersion }));
    } catch (error) {
      if (controller.signal.aborted)
        throw this.commandTimeout(`${executable} app-server plugin/installed`, STATUS_TIMEOUT);
      if (error instanceof PluginInstallError) throw error;
      const code = (error as { code?: unknown }).code;
      const unsupported = code === -32601 ||
        (code === -32600 && error instanceof Error && error.message.includes("plugin/installed"));
      if (!unsupported)
        throw new PluginInstallError("PLUGIN_HOST_COMMAND_FAILED",
          `Codex plugin/installed failed: ${error instanceof Error ? error.message : String(error)}`,
          { host: "codex", command: "plugin/installed" });
    } finally {
      clearTimeout(timer);
      rpc.close();
    }
    // Older app servers can still provide the installed array through their CLI.
    const legacy = await this.listJson("codex", executable, ["list", "--json"], STATUS_TIMEOUT);
    if (!Array.isArray(legacy?.installed)) throw this.tooOld("codex", "Invalid plugin list response.");
    return legacy.installed;
  }

  async status(only?: PluginHost) {
    await mkdir(this.options.root, { recursive: true });
    let source: ReturnType<DesktopPluginInstaller["packageSource"]> | undefined;
    const manual = await this.manualPaths();
    return Promise.all(
      (only ? [only] : PLUGIN_HOSTS).map(
        async (host): Promise<PluginInstallation> => {
          const executable = await this.hostExecutable(host);
          const base = {
            host,
            executable,
            installed: false,
            enabled: false,
            otherSources: [],
            ...(manual[host] ? { manualPath: manual[host] } : {}),
          };
          if (!executable) return { ...base, searched: executablePaths() };
          try {
            return await this.inspect(
              host,
              executable,
              this.expectedVersion(host, (source ??= this.packageSource())),
            );
          } catch (error) {
            return {
              ...base,
              error: error instanceof Error ? error.message : String(error),
              ...(error instanceof PluginInstallError
                ? { errorCode: error.code }
                : {}),
            };
          }
        },
      ),
    );
  }

  async install(input: unknown): Promise<PluginInstallReceipt> {
    const host = pluginHost(input);
    if (this.pending)
      throw new PluginInstallError(
        "PLUGIN_BUSY",
        "A plugin installation is already running.",
      );
    this.pending = true;
    try {
      return host === "deepseek"
        ? await this.stageDsh()
        : await this.installHost(host);
    } finally {
      this.pending = false;
    }
  }

  private async stageDsh(): Promise<PluginInstallReceipt> {
    const executable = await this.hostExecutable("deepseek");
    if (!executable)
      throw new PluginInstallError(
        "PLUGIN_HOST_MISSING",
        "Install DeepSeek Harness first, then refresh.",
        { host: "deepseek" },
      );
    const input = this.packageSource();
    const { runtime } = await input;
    const source = await this.expectedVersion("deepseek", input);
    const staged = await stageDshBundle({
      target: this.dshTarget(),
      bundleRoot: this.options.dshBundleRoot(),
      pluginRoot: this.options.pluginRoot(),
      runtime: runtime.cli,
      home: runtime.home,
    });
    const after = await this.inspectDsh(executable);
    const receipt = {
      host: "deepseek" as const,
      version: staged.version,
      installedPath: staged.path,
      verifiedFiles: staged.verifiedFiles,
      treeSha256: staged.treeSha256,
      home: staged.home,
      dsh: after.dsh,
    };
    await writeFile(
      join(this.options.root, "deepseek-install.json"),
      JSON.stringify(
        { ...receipt, source, verifiedAt: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );
    return receipt;
  }

  private async installHost(
    host: "codex" | "claude" | "antigravity",
  ): Promise<PluginInstallReceipt> {
    if (host === "claude" && this.options.channel === "development")
      throw new PluginInstallError(
        "PLUGIN_DEVELOPMENT_BUILD",
        "Development builds connect Claude Code per checkout: run npm run plugin:claude -- --port <port> in the source directory.",
        { host },
      );
    await mkdir(this.options.root, { recursive: true });
    const executable = await this.hostExecutable(host);
    if (!executable)
      throw new PluginInstallError(
        "PLUGIN_HOST_MISSING",
        `Install ${host === "codex" ? "Codex" : host === "claude" ? "Claude Code" : "Antigravity"} first, then refresh.`,
        { host },
      );
    const before = await this.inspect(host, executable);
    if (before.otherSources.length)
      throw new PluginInstallError(
        "PLUGIN_OTHER_SOURCE",
        `ShowAI is already enabled from ${before.otherSources.join(", ")}. Disable that plugin in the host before installing the App version.`,
        { host, sources: before.otherSources },
      );
    const marketplace = join(this.options.root, host);
    const source = join(marketplace, "plugins/showai");
    let existing: { root?: unknown; path?: unknown } | undefined;
    if (host !== "antigravity") {
      const registered = await this.listJson(host, executable, [
        "marketplace",
        "list",
        "--json",
      ]);
      const marketplaces =
        host === "codex" ? registered?.marketplaces : registered;
      if (!Array.isArray(marketplaces))
        throw this.tooOld(host, JSON.stringify(registered));
      existing = marketplaces.find((item) => item.name === marketplaceName);
      if (existing) {
        const path = host === "codex" ? existing.root : existing.path;
        if (
          typeof path !== "string" ||
          (await realpath(path)) !== (await realpath(marketplace))
        )
          throw new PluginInstallError(
            "PLUGIN_MARKETPLACE_CONFLICT",
            "The showai-desktop marketplace belongs to another installation. Manage that source in the host before retrying.",
            { host, path },
          );
      }
    }
    const sourceInfo = this.packageSource();
    const { manifest, files, runtime } = await sourceInfo;
    const original = fingerprint(files);
    const version = await this.expectedVersion(host, sourceInfo);
    const json = async (path: string, value: unknown) => {
      await writeFile(path, JSON.stringify(value, null, 2) + "\n");
    };
    await mkdir(join(marketplace, "plugins"), { recursive: true });
    const staging = await mkdtemp(join(marketplace, "plugins/.showai-"));
    try {
      await cp(this.options.pluginRoot(), staging, {
        recursive: true,
      });
      if ((await pluginFingerprint(staging)).treeSha256 !== original.treeSha256)
        throw new PluginInstallError(
          "PLUGIN_BUNDLE_CHANGED",
          "The bundled plugin changed while being copied. Retry after the build finishes.",
        );
      await bindHostSkills({
        source: this.options.pluginRoot(),
        target: staging,
        profile: host,
      });
      await rm(join(staging, "host-adapters"), {
        recursive: true,
        force: true,
      });
      const launch = this.hostLaunch(host, runtime);
      await writeRuntimeRecord(
        launch.record,
        runtime.home,
        runtime.cli,
        this.options.channel,
      );
      await json(join(staging, launch.filename), launch.config);
      if (host === "antigravity") {
        await writeAntigravityAssets({
          source: this.options.pluginRoot(),
          target: staging,
          manifest,
          version,
          launch: {
            command: runtime.cli.command,
            env: launch.config.mcpServers.showai.env,
          },
        });
      } else {
        await json(join(staging, "plugin.json"), { ...manifest, version });
      }
      const claudeManifest = JSON.parse(
        await readFile(join(staging, ".claude-plugin/plugin.json"), "utf8"),
      );
      await json(join(staging, ".claude-plugin/plugin.json"), {
        ...claudeManifest,
        version,
      });
      if (launch.launcher || host === "antigravity")
        await writeHostLauncher(this.options.pluginRoot(), staging, host);
      if (launch.launcher) {
        await writeFile(
          join(staging, "mcp", launch.launcher.name),
          launch.launcher.text,
          { mode: 0o755 },
        );
      }
      if (host !== "claude") {
        await rm(join(staging, ".claude-plugin"), {
          recursive: true,
          force: true,
        });
        await rm(join(staging, ".mcp.json"), { force: true });
      }
      if (host !== "codex")
        await rm(join(staging, "mcp.json"), { force: true });
      await publishPluginDirectory(staging, source);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    await mkdir(join(marketplace, ".agents/plugins"), { recursive: true });
    await mkdir(join(marketplace, ".claude-plugin"), { recursive: true });
    await json(join(marketplace, ".agents/plugins/marketplace.json"), {
      name: marketplaceName,
      plugins: [
        {
          name: "showai",
          source: { source: "local", path: "./plugins/showai" },
        },
      ],
    });
    await json(join(marketplace, ".claude-plugin/marketplace.json"), {
      name: marketplaceName,
      owner: { name: "ShowAI" },
      plugins: [{ name: "showai", source: "./plugins/showai", version }],
    });
    const expected = await pluginFingerprint(source);
    let installedPath: string | undefined;
    if (host === "codex") {
      await this.command(executable, [
        "marketplace",
        "add",
        marketplace,
        "--json",
      ]);
      installedPath = JSON.parse(
        await this.command(executable, ["add", identity, "--json"]),
      ).installedPath;
    } else if (host === "claude") {
      if (!existing)
        await this.command(executable, [
          "marketplace",
          "add",
          marketplace,
          "--scope",
          "user",
        ]);
      else
        await this.command(executable, [
          "marketplace",
          "update",
          marketplaceName,
        ]);
      await this.command(executable, [
        before.installed ? "update" : "install",
        identity,
        "--scope",
        "user",
      ]);
      if (!(await this.inspect(host, executable)).enabled)
        await this.command(executable, ["enable", identity, "--scope", "user"]);
    } else {
      await this.command(executable, ["install", source]);
      if (!(await this.inspect(host, executable)).enabled)
        await this.command(executable, ["enable", "showai"]);
    }
    const after = await this.inspect(host, executable);
    installedPath ??= after.installedPath;
    if (
      !after.installed ||
      !after.enabled ||
      after.version !== version ||
      !installedPath ||
      !isAbsolute(installedPath)
    )
      throw new PluginInstallError(
        "PLUGIN_NOT_CONFIRMED",
        "The host did not confirm the expected plugin version is installed and enabled. Check its plugin settings.",
        {
          host,
          expectedVersion: version,
          reportedVersion: after.version ?? null,
          installed: after.installed,
          enabled: after.enabled,
        },
      );
    const actual = await pluginFingerprint(installedPath);
    if (
      actual.treeSha256 !== expected.treeSha256 ||
      (await pluginFingerprint(source)).treeSha256 !== expected.treeSha256
    )
      throw new PluginInstallError(
        "PLUGIN_FILES_MISMATCH",
        "Installed plugin files do not match the App bundle. Refresh the host's plugin cache and retry.",
        { host, installedPath },
      );
    if (host === "antigravity") {
      const validation = (await this.listJson(host, executable, [
        "validate",
        installedPath,
        "--strict",
        "--json",
      ])) as {
        components?: {
          mcpServers?: number;
          sidecars?: number;
          hooks?: number;
          skills?: number;
        };
        findings?: unknown[];
      };
      if (
        (validation.components?.mcpServers ?? 0) < 1 ||
        (validation.components?.sidecars ?? 0) < 1 ||
        (validation.components?.hooks ?? 0) < 1 ||
        (validation.findings?.length ?? 0) > 0
      )
        throw new PluginInstallError(
          "PLUGIN_NOT_CONFIRMED",
          "Antigravity plugin validation did not confirm MCP, hooks, and sidecar workbench.",
          { host, installedPath, validation },
        );
    }
    const receipt = {
      host,
      version,
      installedPath,
      ...actual,
      home: runtime.home,
    };
    await json(join(this.options.root, `${host}-install.json`), {
      ...receipt,
      verifiedAt: new Date().toISOString(),
    });
    return receipt;
  }
}

import {
  access,
  cp,
  mkdir,
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
} from "../agent-host/process";
import {
  registerRuntime,
  runtimeRegistrationStatus,
  writeRuntimeRecord,
  type RuntimeChannel,
  type RuntimeLaunch,
} from "../agent/runtime";
import { PluginInstallError, VERIFIED_HOST_VERSIONS } from "./plugin-errors";
import { bindHostSkills } from "./host-package.mjs";
import {
  inspectDshProfile,
  stageDshBundle,
  type DshProfileState,
} from "./dsh-stage.mjs";

export type PluginHost = "codex" | "claude" | "deepseek";
/** Changes DeepSeek Harness needs from the person; ShowAI never edits its profile. */
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
  /** The installed or staged copy is the one this App would install now (same plugin files, runtime and library). */
  current?: boolean;
  /** Identifies what this App would install now; it changes with the App, its bundled plugin or the library. */
  expected?: string;
  installedPath?: string;
  otherSources: string[];
  error?: string;
  /** Code of `error` for a localized message; the raw text stays in `error`. */
  errorCode?: string;
  /** Library the installed plugin is bound to (from the install receipt). */
  boundHome?: string;
  /** Not found: the directories searched, for the person to compare with their shell. */
  searched?: string[];
  /** Executable the person chose by hand. */
  manualPath?: string;
  /** DeepSeek Harness only: the staged bundle and remaining host-side steps. */
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

const marketplaceName = "showai-desktop";
const identity = `showai@${marketplaceName}`;
export const desktopPluginActions = new Set([
  "plugins:status",
  "plugins:install",
  "plugins:runtime",
  "plugins:repairRuntime",
  "plugins:setPath",
  "plugins:launchConfig",
]);

/** One dispatch for the desktop IPC handler and the local browser server. */
export function pluginInstallerAction(
  installer: DesktopPluginInstaller,
  action: string,
  args: Record<string, unknown>,
) {
  switch (action) {
    case "plugins:status":
      return installer.status();
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
      throw new PluginInstallError("PLUGIN_UNKNOWN_HOST", `Unknown plugin action: ${action}`);
  }
}

export async function pluginFingerprint(root: string) {
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
  return {
    verifiedFiles: files.length,
    treeSha256: createHash("sha256")
      .update(JSON.stringify(files))
      .digest("hex"),
  };
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

/** Harness is detected by its Desktop app; its bundles are installed from inside Harness. */
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

/** Writes a script that starts the runtime with the plugin's arguments; returns its file name. */
async function writeLauncher(
  directory: string,
  server: { command: string; args: string[] },
) {
  const words = [server.command, ...server.args];
  if (process.platform === "win32") {
    const line = words.map((word) => `"${word}"`).join(" ");
    await writeFile(
      join(directory, "showai-mcp.cmd"),
      `@echo off\r\n${line} %*\r\n`,
    );
    return "showai-mcp.cmd";
  }
  const line = words
    .map((word) => `'${word.replaceAll("'", `'\\''`)}'`)
    .join(" ");
  await writeFile(
    join(directory, "showai-mcp"),
    `#!/bin/sh\nexec ${line} "$@"\n`,
    { mode: 0o755 },
  );
  return "showai-mcp";
}

export async function hostExecutable(host: PluginHost) {
  if (host === "deepseek") return dshApplication();
  const executable = await findExecutable(host);
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

/** Plugin hosts the App drives through their official CLIs. */
export const PLUGIN_HOSTS = ["codex", "claude", "deepseek"] as const;
function pluginHost(value: unknown): PluginHost {
  if (!PLUGIN_HOSTS.includes(value as PluginHost))
    throw new PluginInstallError("PLUGIN_UNKNOWN_HOST", "Unknown plugin host.");
  return value as PluginHost;
}

/**
 * Fixed hosts and arguments; the page cannot supply commands. The only path it
 * supplies is a host executable the person chose, which must exist and be executable.
 * The desktop App and the local browser server share it: both run on the person's machine.
 */
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

  /** The person's chosen executable wins over detection while it still exists. */
  private async hostExecutable(host: PluginHost) {
    const manual = (await this.manualPaths())[host];
    if (manual && (await exists(manual, constants.X_OK))) return manual;
    return hostExecutable(host);
  }

  /** Persists a host executable chosen by hand; an empty path returns to detection. */
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

  /** The library's runtime registration compared with this App. */
  runtimeStatus() {
    const runtime = this.options.runtime();
    return runtimeRegistrationStatus(
      runtime.home,
      runtime.cli,
      this.options.channel,
    );
  }

  /** 修复登记: registers this App for the current library, replacing any other registration. */
  async repairRuntime() {
    const runtime = this.options.runtime();
    await registerRuntime(runtime.home, runtime.cli, this.options.channel);
    return this.runtimeStatus();
  }

  /**
   * How to start the plugin's launcher by hand: the App's executable runs
   * mcp/launch.mjs, which checks the registered runtime and starts its `mcp` entry.
   */
  launchConfig() {
    const runtime = this.options.runtime();
    return {
      command: runtime.cli.command,
      args: [join(this.options.pluginRoot(), "mcp/launch.mjs")],
      env: { ...runtime.cli.env, SHOWAI_HOME: runtime.home },
    };
  }

  private async command(executable: string, args: string[]) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: executablePaths().join(delimiter),
    };
    // Host CLIs must run as themselves, even when this caller is Electron.
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await execute(executable, ["plugin", ...args], {
      env,
      cwd: this.options.root,
      timeout: 120000,
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

  /** Older host CLIs print text or another JSON shape for `--json`; that needs a newer host. */
  private async listJson(
    host: "codex" | "claude",
    executable: string,
    args: string[],
  ) {
    const output = await this.command(executable, args);
    try {
      return JSON.parse(output);
    } catch {
      throw this.tooOld(host, output);
    }
  }

  private tooOld(host: "codex" | "claude", output: string) {
    return new PluginInstallError(
      "PLUGIN_HOST_TOO_OLD",
      `This ${host === "codex" ? "Codex" : "Claude Code"} does not report plugins as JSON; update it to ${VERIFIED_HOST_VERSIONS[host]} or later.`,
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
    // The staging receipt records which App bundle, runtime and library produced the files.
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

  /**
   * The version installHost() gives the plugin: the bundled manifest version plus a hash of the
   * bundled files and this runtime launch, which includes the library. A different library, a moved
   * App or a newer bundle changes it.
   */
  private async expectedVersion() {
    const manifest = JSON.parse(
      await readFile(join(this.options.pluginRoot(), "plugin.json"), "utf8"),
    );
    if (manifest.name !== "showai" || typeof manifest.version !== "string")
      throw new PluginInstallError(
        "PLUGIN_BUNDLE_INVALID",
        "Invalid bundled ShowAI plugin.",
      );
    const original = await pluginFingerprint(this.options.pluginRoot());
    const version = `${manifest.version}+desktop.${createHash("sha256")
      .update(JSON.stringify([original.treeSha256, this.options.runtime()]))
      .digest("hex")
      .slice(0, 12)}`;
    return { manifest, original, version };
  }

  /**
   * What a staged Harness bundle should be built from: the bundled Harness files, the bundled
   * plugin and this runtime launch, which includes the library.
   */
  private async dshSource() {
    const [bundle, plugin] = await Promise.all([
      pluginFingerprint(this.options.dshBundleRoot()),
      pluginFingerprint(this.options.pluginRoot()),
    ]);
    return createHash("sha256")
      .update(
        JSON.stringify([
          bundle.treeSha256,
          plugin.treeSha256,
          this.options.runtime(),
        ]),
      )
      .digest("hex")
      .slice(0, 12);
  }

  private async inspect(
    host: PluginHost,
    executable: string,
    expected?: Promise<string>,
  ): Promise<PluginInstallation> {
    if (host === "deepseek") return this.inspectDsh(executable, expected);
    const data = await this.listJson(host, executable, ["list", "--json"]);
    const items = host === "codex" ? data?.installed : data;
    if (!Array.isArray(items)) throw this.tooOld(host, JSON.stringify(data));
    const receipt = await readFile(
      join(this.options.root, `${host}-install.json`),
      "utf8",
    ).then(
      (text) => JSON.parse(text) as { home?: unknown },
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    const own = items.find(
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
      current:
        !!own?.version && !!expected && own.version === (await expected),
      expected: expected ? await expected : undefined,
      installedPath: own?.installedPath ?? own?.installPath,
      ...(own && typeof receipt?.home === "string"
        ? { boundHome: receipt.home }
        : {}),
      otherSources: items
        .filter((item) => {
          const id = item.pluginId ?? item.id;
          return (
            typeof id === "string" &&
            id.startsWith("showai@") &&
            id !== identity &&
            item.enabled
          );
        })
        .map((item) => item.pluginId ?? item.id),
    };
  }

  async status() {
    await mkdir(this.options.root, { recursive: true });
    let expected: Promise<string> | undefined;
    const manual = await this.manualPaths();
    return Promise.all(
      PLUGIN_HOSTS.map(
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
          // Each host is an independent I/O boundary; one failure must not hide the other.
          try {
            return await this.inspect(
              host,
              executable,
              host === "deepseek"
                ? this.dshSource()
                : (expected ??= this.expectedVersion().then(
                    (item) => item.version,
                  )),
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

  /** Harness installs bundles itself; the App stages files and reports the remaining steps. */
  private async stageDsh(): Promise<PluginInstallReceipt> {
    const executable = await this.hostExecutable("deepseek");
    if (!executable)
      throw new PluginInstallError(
        "PLUGIN_HOST_MISSING",
        "Install DeepSeek Harness first, then refresh.",
        { host: "deepseek" },
      );
    const runtime = this.options.runtime();
    const source = await this.dshSource();
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
    host: "codex" | "claude",
  ): Promise<PluginInstallReceipt> {
    // The user-scope Claude plugin follows the stable App; a development build would rebind it.
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
        `Install ${host === "codex" ? "Codex" : "Claude Code"} first, then refresh.`,
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
    const registered = await this.listJson(host, executable, [
      "marketplace",
      "list",
      "--json",
    ]);
    const marketplaces =
      host === "codex" ? registered?.marketplaces : registered;
    if (!Array.isArray(marketplaces))
      throw this.tooOld(host, JSON.stringify(registered));
    const existing = marketplaces.find((item) => item.name === marketplaceName);
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
    const runtime = this.options.runtime();
    const { manifest, original, version } = await this.expectedVersion();
    // Only this App-owned staging directory is replaced; host caches are managed by official CLIs.
    await rm(source, { recursive: true, force: true });
    await cp(this.options.pluginRoot(), source, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    if ((await pluginFingerprint(source)).treeSha256 !== original.treeSha256)
      throw new PluginInstallError(
        "PLUGIN_BUNDLE_CHANGED",
        "The bundled plugin changed while being copied. Retry after the build finishes.",
      );
    await bindHostSkills({
      source: this.options.pluginRoot(),
      target: source,
      profile: host,
    });
    await rm(join(source, "host-adapters"), { recursive: true, force: true });
    const json = async (path: string, value: unknown) => {
      await writeFile(path, JSON.stringify(value, null, 2) + "\n");
    };
    // Use the App's executable instead of requiring Node on the user's PATH.
    // Pin this connection to the selected library and to this App's runtime: the record lives
    // outside the library, so another App registering there does not rebind the plugin.
    const record = join(this.options.root, `${host}-runtime.json`);
    await writeRuntimeRecord(
      record,
      runtime.home,
      runtime.cli,
      this.options.channel,
    );
    const server = {
      command: runtime.cli.command,
      args: [join(source, "mcp/launch.mjs")],
      env: {
        ...runtime.cli.env,
        SHOWAI_HOME: runtime.home,
        SHOWAI_RUNTIME_CONFIG: record,
      },
    };
    await json(join(source, "plugin.json"), { ...manifest, version });
    const claudeManifest = JSON.parse(
      await readFile(join(source, ".claude-plugin/plugin.json"), "utf8"),
    );
    await json(join(source, ".claude-plugin/plugin.json"), {
      ...claudeManifest,
      version,
    });
    // Each host declares how show_component reaches its conversation.
    if (host === "codex") {
      // Codex reads the Agent Plugins mcp.json and silently drops a server whose file lacks
      // $schema or whose command is an absolute path; it accepts a `./` launcher in the plugin.
      const launcher = await writeLauncher(join(source, "mcp"), server);
      await json(join(source, "mcp.json"), {
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: {
          showai: {
            type: "stdio",
            command: `./mcp/${launcher}`,
            args: [],
            env: { ...server.env, SHOWAI_HOST_DISPLAY: "codex-visualize" },
          },
        },
      });
      await rm(join(source, ".claude-plugin"), {
        recursive: true,
        force: true,
      });
      await rm(join(source, ".mcp.json"), { force: true });
    } else {
      await json(join(source, ".mcp.json"), {
        mcpServers: {
          showai: {
            ...server,
            env: { ...server.env, SHOWAI_HOST_DISPLAY: "model-html" },
          },
        },
      });
      await rm(join(source, "mcp.json"), { force: true });
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
    } else {
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

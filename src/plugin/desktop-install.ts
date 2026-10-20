import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import {
  execute,
  executablePaths,
  findExecutable,
} from "../agent-host/process";
import type { RuntimeLaunch } from "../agent/runtime";
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
  /** Codex and Claude Code: the installed copy is the one this App would install now (same plugin files, runtime and library). */
  current?: boolean;
  installedPath?: string;
  otherSources: string[];
  error?: string;
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
]);

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
      else throw new Error(`Unsupported plugin file: ${name}`);
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

async function hostExecutable(host: PluginHost) {
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

/** Desktop-only: fixed hosts and arguments; renderer cannot supply commands or paths. */
export class DesktopPluginInstaller {
  private pending = false;
  constructor(
    private options: {
      root: string;
      pluginRoot: () => string;
      dshBundleRoot: () => string;
      runtime: () => { home: string; cli: RuntimeLaunch };
    },
  ) {}

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
      throw new Error(
        (
          result.stderr ||
          result.stdout ||
          `Plugin command exited ${result.code}`
        ).trim(),
      );
    return result.stdout;
  }

  private dshTarget() {
    return join(this.options.root, "deepseek/showai");
  }

  private async inspectDsh(executable: string): Promise<PluginInstallation> {
    const target = this.dshTarget();
    const staged = await readFile(join(target, "package.json"), "utf8").then(
      (text) => JSON.parse(text) as { version?: string },
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
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
      throw new Error("Invalid bundled ShowAI plugin.");
    const original = await pluginFingerprint(this.options.pluginRoot());
    const version = `${manifest.version}+desktop.${createHash("sha256")
      .update(JSON.stringify([original.treeSha256, this.options.runtime()]))
      .digest("hex")
      .slice(0, 12)}`;
    return { manifest, original, version };
  }

  private async inspect(
    host: PluginHost,
    executable: string,
    expected?: Promise<string>,
  ): Promise<PluginInstallation> {
    if (host === "deepseek") return this.inspectDsh(executable);
    const data = JSON.parse(await this.command(executable, ["list", "--json"]));
    const items = host === "codex" ? data.installed : data;
    if (!Array.isArray(items))
      throw new Error(
        "Unrecognized plugin list. Update the host application and retry.",
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
      installedPath: own?.installedPath ?? own?.installPath,
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
    return Promise.all(
      (["codex", "claude", "deepseek"] as const).map(
        async (host): Promise<PluginInstallation> => {
          const executable = await hostExecutable(host);
          const base = {
            host,
            executable,
            installed: false,
            enabled: false,
            otherSources: [],
          };
          if (!executable) return base;
          // Each host is an independent I/O boundary; one failure must not hide the other.
          try {
            return await this.inspect(
              host,
              executable,
              host === "deepseek"
                ? undefined
                : (expected ??= this.expectedVersion().then(
                    (item) => item.version,
                  )),
            );
          } catch (error) {
            return {
              ...base,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
      ),
    );
  }

  async install(host: unknown): Promise<PluginInstallReceipt> {
    if (host !== "codex" && host !== "claude" && host !== "deepseek")
      throw new Error("Unknown plugin host.");
    if (this.pending)
      throw new Error("A plugin installation is already running.");
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
    const executable = await hostExecutable("deepseek");
    if (!executable)
      throw new Error("Install DeepSeek Harness first, then refresh.");
    const runtime = this.options.runtime();
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
        { ...receipt, verifiedAt: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );
    return receipt;
  }

  private async installHost(host: PluginHost): Promise<PluginInstallReceipt> {
    await mkdir(this.options.root, { recursive: true });
    const executable = await hostExecutable(host);
    if (!executable)
      throw new Error(
        `Install ${host === "codex" ? "Codex" : "Claude Code"} first, then refresh.`,
      );
    const before = await this.inspect(host, executable);
    if (before.otherSources.length)
      throw new Error(
        `ShowAI is already enabled from ${before.otherSources.join(", ")}. Disable that plugin in the host before installing the App version.`,
      );
    const marketplace = join(this.options.root, host);
    const source = join(marketplace, "plugins/showai");
    const registered = JSON.parse(
      await this.command(executable, ["marketplace", "list", "--json"]),
    );
    const marketplaces =
      host === "codex" ? registered.marketplaces : registered;
    if (!Array.isArray(marketplaces))
      throw new Error(
        "Unrecognized marketplace list. Update the host application and retry.",
      );
    const existing = marketplaces.find((item) => item.name === marketplaceName);
    if (existing) {
      const path = host === "codex" ? existing.root : existing.path;
      if (
        typeof path !== "string" ||
        (await realpath(path)) !== (await realpath(marketplace))
      )
        throw new Error(
          "The showai-desktop marketplace belongs to another installation. Manage that source in the host before retrying.",
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
      throw new Error(
        "The bundled plugin changed while being copied. Retry after the build finishes.",
      );
    const json = async (path: string, value: unknown) => {
      await writeFile(path, JSON.stringify(value, null, 2) + "\n");
    };
    // Use the App's executable instead of requiring Node on the user's PATH.
    // Pin this connection to the selected library; launch.mjs still verifies its registered runtime.
    const server = {
      command: runtime.cli.command,
      args: [join(source, "mcp/launch.mjs")],
      env: { ...runtime.cli.env, SHOWAI_HOME: runtime.home },
    };
    await json(join(source, "plugin.json"), { ...manifest, version });
    const claudeManifest = JSON.parse(
      await readFile(join(source, ".claude-plugin/plugin.json"), "utf8"),
    );
    await json(join(source, ".claude-plugin/plugin.json"), {
      ...claudeManifest,
      version,
    });
    await json(join(source, "mcp.json"), {
      mcpServers: { showai: { type: "stdio", ...server } },
    });
    await json(join(source, ".mcp.json"), { mcpServers: { showai: server } });
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
      throw new Error(
        "The host did not confirm the expected plugin version is installed and enabled. Check its plugin settings.",
      );
    const actual = await pluginFingerprint(installedPath);
    if (
      actual.treeSha256 !== expected.treeSha256 ||
      (await pluginFingerprint(source)).treeSha256 !== expected.treeSha256
    )
      throw new Error(
        "Installed plugin files do not match the App bundle. Refresh the host's plugin cache and retry.",
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

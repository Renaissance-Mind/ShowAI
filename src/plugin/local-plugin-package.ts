import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  writeRuntimeRecord,
  type RuntimeChannel,
  type RuntimeLaunch,
} from "../agent/runtime";
import { withLibraryLock } from "../core/library-lock";
import { publishPluginDirectory } from "./host-package.mjs";
import { cursorWorkbenchArchive } from "./cursor-workbench-package.mjs";
import {
  universalPluginArchive,
  universalPluginFiles,
} from "./universal-package.mjs";

function versionWorkBuddyPackage(files: Map<string, Buffer>, version: string) {
  // WorkBuddy's plugin manager reuses the cached directory for the same version.
  const fingerprint = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) =>
    [name, createHash("sha256").update(bytes).digest("hex")],
  );
  const build = createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex").slice(0, 12);
  const boundVersion = version.split("+")[0] + "+desktop." + build;
  const pluginPath = ".workbuddy-plugin/plugin.json";
  const marketPath = ".workbuddy-plugin/marketplace.json";
  const plugin = JSON.parse(files.get(pluginPath)!.toString("utf8"));
  const market = JSON.parse(files.get(marketPath)!.toString("utf8"));
  files.set(pluginPath, Buffer.from(JSON.stringify({ ...plugin, version: boundVersion }, null, 2) + "\n"));
  files.set(marketPath, Buffer.from(JSON.stringify({
    ...market, plugins: market.plugins.map((item: Record<string, unknown>) => ({ ...item, version: boundVersion })),
  }, null, 2) + "\n"));
}

export interface LocalPluginPackageOptions {
  root: string;
  pluginRoot: () => string;
  kimiBundleRoot: () => string;
  runtime: () => { home: string; cli: RuntimeLaunch };
  channel: RuntimeChannel;
}

export async function prepareLocalPlugin(
  host: unknown,
  options: LocalPluginPackageOptions,
) {
  if (
    host !== "kimi" &&
    host !== "kimi-code" &&
    host !== "cursor" &&
    host !== "cursor-ide" &&
    host !== "trae" &&
    host !== "qoder" &&
    host !== "workbuddy"
  )
    throw new Error("Unknown local plugin package.");
  const { home, cli } = options.runtime();
  const libraryKey = createHash("sha256")
    .update(home)
    .digest("hex")
    .slice(0, 16);
  const root = join(options.root, "packages", libraryKey);
  const name = `showai-${host}`;
  const runtimeConfig = join(root, "agent-runtime.json");
  return withLibraryLock(
    home,
    async () => {
      await writeRuntimeRecord(runtimeConfig, home, cli, options.channel);
      const staging = await mkdtemp(join(root, ".prepare-"));
      try {
        if (host === "kimi") {
          await cp(options.kimiBundleRoot(), staging, { recursive: true });
          const path = join(staging, "kimi.plugin.json");
          const manifest = JSON.parse(await readFile(path, "utf8"));
          Object.assign(manifest.mcpServers.showai.env, {
            SHOWAI_HOME: home,
            SHOWAI_RUNTIME_CONFIG: runtimeConfig,
          });
          await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
        } else if (host === "cursor-ide" || host === "trae") {
          const file = name + ".vsix";
          const bytes = await cursorWorkbenchArchive(options.pluginRoot(), {
            runtimeConfig, host: host === "trae" ? "trae" : "cursor",
          });
          await writeFile(join(staging, file), bytes);
          await rename(join(staging, file), join(root, file));
          return { path: join(root, file) };
        } else {
          const config = {
            host,
            name,
            displayName: "ShowAI",
            mcp: "local",
            runtimeConfig,
          } as const;
          if (host === "qoder") {
            const { bytes } = await universalPluginArchive(
              options.pluginRoot(),
              config,
            );
            const file = name + ".zip";
            await writeFile(join(staging, file), bytes);
            await rename(join(staging, file), join(root, file));
            return { path: join(root, file) };
          }
          const { files, version } = await universalPluginFiles(
            options.pluginRoot(),
            config,
          );
          if (host === "workbuddy") versionWorkBuddyPackage(files, version);
          for (const [file, bytes] of files) {
            const path = join(staging, file);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, bytes);
          }
        }
        const path = join(root, name);
        await publishPluginDirectory(staging, path);
        return { path };
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    },
    "prepare-local-plugin",
  );
}

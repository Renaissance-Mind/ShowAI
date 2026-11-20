import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve, relative, sep } from "node:path";

export const HOST_PROFILES = {
  codex: "mcp-app",
  claude: "model-html",
  antigravity: "fragment-file",
  deepseek: "fragment-file",
  kimi: "fragment-file",
  "mcp-app": "mcp-app",
};
export const HOST_GUIDE = "use-showai/references/host-adapter.md";
const hash = (value) => createHash("sha256").update(value).digest("hex");

export async function skillFiles(root) {
  const files = {};
  async function visit(directory, prefix = "") {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix + entry.name;
      if (entry.isDirectory())
        await visit(join(directory, entry.name), name + "/");
      else if (entry.isFile())
        files[name] = hash(await readFile(join(directory, entry.name)));
      else throw new Error(`Unsupported Skill file: ${name}`);
    }
  }
  await visit(root);
  return files;
}

export async function bindHostSkills({ source, target, profile }) {
  if (!Object.hasOwn(HOST_PROFILES, profile))
    throw new Error(`Unknown ShowAI host profile: ${profile}`);
  if (resolve(source) === resolve(target))
    throw new Error(
      "Bind a host profile in a distribution copy, not in the common source.",
    );
  const adapter = await readFile(
    join(source, "host-adapters", `${profile}.md`),
    "utf8",
  );
  const sourceFiles = await skillFiles(join(source, "skills"));
  if (!(HOST_GUIDE in sourceFiles))
    throw new Error(
      "The common Skills must contain the host adapter reference.",
    );
  await rm(join(target, "skills"), { recursive: true, force: true });
  await cp(join(source, "skills"), join(target, "skills"), { recursive: true });
  await writeFile(join(target, "skills", HOST_GUIDE), adapter);
  const commonFiles = Object.fromEntries(
    Object.entries(sourceFiles).filter(([name]) => name !== HOST_GUIDE),
  );
  const expected = { ...commonFiles };
  const entry = "use-showai/SKILL.md";
  const notePath =
    profile === "codex"
      ? join(source, "host-adapters/codex-entry.md")
      : profile === "antigravity"
        ? join(source, "host-adapters/antigravity-entry.md")
        : undefined;
  const note = notePath ? await readFile(notePath, "utf8") : undefined;
  if (note !== undefined) {
    const original = await readFile(join(source, "skills", entry), "utf8");
    const bound = original.trimEnd() + "\n\n" + note;
    await writeFile(join(target, "skills", entry), bound);
    expected[entry] = hash(bound);
  }
  const copied = await skillFiles(join(target, "skills"));
  const copiedCommon = Object.fromEntries(
    Object.entries(copied).filter(([name]) => name !== HOST_GUIDE),
  );
  if (
    JSON.stringify(copiedCommon) !== JSON.stringify(expected) ||
    (note !== undefined && (await readFile(notePath, "utf8")) !== note) ||
    JSON.stringify(await skillFiles(join(source, "skills"))) !==
      JSON.stringify(sourceFiles) ||
    (await readFile(join(source, "host-adapters", `${profile}.md`), "utf8")) !==
      adapter
  ) {
    throw new Error(
      "The common Skills or host adapter changed while packaging. Retry after the source settles.",
    );
  }
  const receipt = {
    protocol: "showai-host-profile-v1",
    profile,
    declaredHostDisplay: HOST_PROFILES[profile],
    commonVersion: JSON.parse(
      await readFile(join(source, "plugin.json"), "utf8"),
    ).version,
    commonSha256: hash(JSON.stringify(commonFiles)),
    commonFiles,
    adapterSha256: hash(adapter),
    ...(note !== undefined && { entrySha256: expected[entry] }),
  };
  await writeFile(
    join(target, "host-profile.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  return receipt;
}

export async function writeHostLauncher(source, target, profile) {
  const template = await readFile(
    join(source, "host-adapters/launch.mjs.in"),
    "utf8",
  );
  const parts = template.split("__SHOWAI_PROBE_CACHE_PATH__");
  if (parts.length !== 2)
    throw new Error(
      "Expected one probe cache path in the MCP launcher template.",
    );
  const cache =
    profile === "codex"
      ? 'join(env.SHOWAI_CODEX_WORKBENCH_PROFILE || join(home, "local"), "agent-runtime-probe.json")'
      : 'join(home, "local", "agent-runtime-probe.json")';
  const cwd = profile === "codex"
    ? "    // Codex can retire the versioned plugin directory while its chat is open.\n" +
      "    ...(launch.env.SHOWAI_CODEX_WORKBENCH_PROFILE && { cwd: home }),\n"
    : profile === "antigravity"
      ? "    // Antigravity replaces the plugin directory in place while its MCP server stays open.\n" +
        "    cwd: (await mkdir(home, { recursive: true }).catch(() => {}), home),\n"
      : "";
  await writeFile(join(target, "mcp/launch.mjs"), parts.join(cache).replace("__SHOWAI_HOST_CWD__\n", cwd));
}

export async function publishPluginDirectory(staging, target) {
  const previous = target + ".previous-" + randomUUID();
  const moved = await rename(target, previous).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  try {
    await rename(staging, target);
  } catch (error) {
    if (moved) await rename(previous, target);
    throw error;
  }
  if (moved) await rm(previous, { recursive: true });
}

function shellQuote(value) {
  if (process.platform === "win32") {
    return `"${String(value).replaceAll('"', '""')}"`;
  }
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function antigravityHookCommand(launch) {
  if (!launch?.command) return "node ./hooks/preview-hook.mjs";
  const envEntries = Object.entries(launch.env ?? {}).filter(
    ([key, value]) =>
      ["ELECTRON_RUN_AS_NODE", "SHOWAI_HOME", "SHOWAI_PRESENTATION_DIR"].includes(key) &&
      typeof value === "string",
  );
  if (process.platform === "win32") {
    const sets = envEntries.map(([key, value]) => `set "${key}=${value}"`);
    return [...sets, `${shellQuote(launch.command)} ./hooks/preview-hook.mjs`].join(" && ");
  }
  const prefix = envEntries.map(([key, value]) => `${key}=${shellQuote(value)}`).join(" ");
  return [prefix, shellQuote(launch.command), "./hooks/preview-hook.mjs"]
    .filter(Boolean)
    .join(" ");
}

export function antigravityManifest(manifest, version = manifest.version) {
  return {
    name: manifest.name || "showai",
    displayName: "ShowAI",
    version,
    description:
      "Create, edit, and present interactive ShowAI pages, diagrams, and components with a live side-pane workbench.",
    logo: "assets/logo.svg",
    author: {
      name: "Renaissance Mind",
      url: "https://github.com/Renaissance-Mind",
    },
    homepage: "https://github.com/Renaissance-Mind/ShowAI",
    repository: "https://github.com/Renaissance-Mind/ShowAI",
    suggestedPrompts: [
      "Use ShowAI to turn this topic into an interactive page.",
      "Draw an interactive architecture diagram in ShowAI.",
      "Open my recent ShowAI pages in the workbench.",
    ],
  };
}

export function antigravityHookConfig(launch) {
  const command = antigravityHookCommand(launch);
  return {
    "showai-preview": {
      PostToolUse: [
        {
          matcher:
            ".*(?:show_component|page_present|render_document).*|call_mcp_tool|mcp_tool",
          hooks: [
            {
              type: "command",
              command,
              timeout: 15,
            },
          ],
        },
      ],
      PreInvocation: [
        {
          type: "command",
          command,
          timeout: 10,
        },
      ],
    },
  };
}

export function antigravitySidecarConfig(launch) {
  const env = {};
  for (const key of [
    "ELECTRON_RUN_AS_NODE",
    "SHOWAI_HOME",
    "SHOWAI_RUNTIME_CONFIG",
    "SHOWAI_PRESENTATION_DIR",
  ]) {
    if (typeof launch?.env?.[key] === "string") env[key] = launch.env[key];
  }
  return {
    command: launch?.command || "node",
    args: ["main.mjs"],
    ...(Object.keys(env).length ? { env } : {}),
    restart_policy: "on-failure",
    display_name: "ShowAI",
    description:
      "Live ShowAI workbench in the side pane: browse, edit, and reference ShowAI pages alongside your Antigravity conversation.",
    has_web_ui: true,
    agent_permissions: {
      allows_user_interactions: true,
    },
    ui_config: {
      display_name: "ShowAI",
      views: [
        {
          entrypoint: "SIDECAR_UI_ENTRYPOINT_AUX_PANE",
          path: "/",
          title: "ShowAI",
        },
      ],
    },
  };
}

export async function writeAntigravityAssets({
  source,
  target,
  manifest,
  version = manifest.version,
  launch,
}) {
  const assetsRoot = join(source, "host-adapters/antigravity");
  await cp(join(assetsRoot, "hooks"), join(target, "hooks"), {
    recursive: true,
  });
  await cp(join(assetsRoot, "sidecars"), join(target, "sidecars"), {
    recursive: true,
  });
  await writeFile(
    join(target, "plugin.json"),
    JSON.stringify(antigravityManifest(manifest, version), null, 2) + "\n",
  );
  await writeFile(
    join(target, "hooks.json"),
    JSON.stringify(antigravityHookConfig(launch), null, 2) + "\n",
  );
  await writeFile(
    join(target, "sidecars/workbench/sidecar.json"),
    JSON.stringify(antigravitySidecarConfig(launch), null, 2) + "\n",
  );
}

export async function stageHostPlugin({ source, target, profile }) {
  if (!["codex", "claude", "antigravity"].includes(profile))
    throw new Error(`Use the native bundle packager for ${profile}.`);
  const path = relative(resolve(source), resolve(target));
  if (
    !path ||
    (!path.startsWith(".." + sep) && path !== ".." && !isAbsolute(path))
  ) {
    throw new Error("Host packages must be outside the common plugin source.");
  }
  const previous = await readFile(
    join(target, "host-profile.json"),
    "utf8",
  ).then(JSON.parse, (error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (
    previous &&
    (previous.protocol !== "showai-host-profile-v1" ||
      previous.profile !== profile)
  ) {
    throw new Error(`Another host owns ${target}.`);
  }
  const entries = await readdir(target).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  if (entries.length && !previous)
    throw new Error(`Refusing to replace a non-generated plugin: ${target}`);
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), ".host-package-"));
  try {
    await cp(source, staging, {
      recursive: true,
      filter: (file) =>
        relative(source, file).split(sep)[0] !== "host-adapters",
    });
    const receipt = await bindHostSkills({ source, target: staging, profile });
    if (profile === "codex") {
      await writeHostLauncher(source, staging, profile);
      await rm(join(staging, ".claude-plugin"), {
        recursive: true,
        force: true,
      });
      await rm(join(staging, ".mcp.json"), { force: true });
    } else if (profile === "claude") {
      await rm(join(staging, "mcp.json"), { force: true });
    } else {
      await writeHostLauncher(source, staging, profile);
      const manifest = JSON.parse(
        await readFile(join(source, "plugin.json"), "utf8"),
      );
      await rm(join(staging, ".claude-plugin"), {
        recursive: true,
        force: true,
      });
      await rm(join(staging, ".mcp.json"), { force: true });
      await rm(join(staging, "mcp.json"), { force: true });
      await writeAntigravityAssets({
        source,
        target: staging,
        manifest,
      });
      await writeFile(
        join(staging, "mcp_config.json"),
        JSON.stringify(
          {
            mcpServers: {
              showai: {
                command: "node",
                args: ["./mcp/launch.mjs"],
                cwd: "./",
                env: { SHOWAI_HOST_DISPLAY: receipt.declaredHostDisplay },
              },
            },
          },
          null,
          2,
        ) + "\n",
      );
    }
    await publishPluginDirectory(staging, target);
    return receipt;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

import {
  access,
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve, join, relative, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTemplateReadme } from "../src/portable/template-bundle.mjs";
import { packageSkillFormats } from "./package-skill-formats.mjs";
import {
  bindHostSkills,
  bindWorkflowDelivery,
  publishPluginDirectory,
  stageHostPlugin,
  writeHostLauncher,
} from "../src/plugin/host-package.mjs";
import {
  universalPluginArchive,
  universalPluginFiles,
} from "../src/plugin/universal-package.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "plugins/showai");
await packageSkillFormats();
await writeHostLauncher(plugin, plugin, "mcp-app");
const args = process.argv.slice(2);
const settings = {};
for (let i = 0; i < args.length; i += 2) {
  if (
    ![
      "--mcp-url",
      "--mcp",
      "--mcp-auth",
      "--runtime-config",
      "--host",
      "--out",
      "--name",
      "--display-name",
      "--chatgpt-app",
    ].includes(args[i]) ||
    !args[i + 1]
  )
    throw new Error(
      "Usage: package-plugin.mjs [--out NEW_DIRECTORY_OR_ZIP [--host cursor|qoder|workbuddy] [--mcp local|MCP_URL] [--runtime-config ABSOLUTE_PATH] [--mcp-auth oauth|none] [--mcp-url MANUAL_SETUP_HINT] [--name PLUGIN_NAME] [--display-name NAME] [--chatgpt-app asdk_app_ID]]",
    );
  settings[args[i]] = args[i + 1];
}
for (const path of [
  "scripts",
  "node_modules",
  "assets/viewer.html",
  "assets/build.json",
  "skills/show-document/examples",
  "skills/show-document/references/agent-usage.md",
  "skills/show-document/references/artifact-format.md",
  "skills/show-document/references/catalog-lifecycle.md",
])
  await rm(join(plugin, path), { recursive: true, force: true });
const manifest = JSON.parse(
  await readFile(join(plugin, "plugin.json"), "utf8"),
);
await copyFile(
  join(plugin, "host-adapters/mcp-app.md"),
  join(plugin, "skills/use-showai/references/host-adapter.md"),
);
await bindWorkflowDelivery(
  join(plugin, "skills"),
  join(plugin, "skills"),
  await readFile(join(plugin, "host-adapters/mcp-app.md"), "utf8"),
);
const workflowSource = await readFile(
  join(root, "resources/templates/system-presentation/README.md"),
  "utf8",
);
const workflowMetadata = parseTemplateReadme(workflowSource).metadata;
const workflowParts = [parseTemplateReadme(workflowSource).body];
for (const path of workflowMetadata.guides)
  workflowParts.push(
    (
      await readFile(
        join(root, "resources/templates/system-presentation", path),
        "utf8",
      )
    ).trim(),
  );
const demote = (markdown) =>
  markdown.replace(/^(#{1,5}) /gm, (_, marks) => `${marks}# `);
const workflow = workflowParts.map(demote).join("\n\n");
const visualPrinciples =
  /(?:^|\n)## 视觉表达原则\n+([\s\S]*?)(?=\n## |(?![\s\S]))/.exec(
    workflowParts[0],
  )?.[1];
if (!visualPrinciples)
  throw new Error("The system workflow is missing its 视觉表达原则 section.");
async function fill(path, slot, content) {
  const source = await readFile(path, "utf8");
  const pattern = new RegExp(
    `<!-- ${slot}:start -->[\\s\\S]*?<!-- ${slot}:end -->`,
  );
  if (!pattern.test(source))
    throw new Error(`${relative(plugin, path)} is missing its ${slot} slot.`);
  await writeFile(
    path,
    source.replace(
      pattern,
      `<!-- ${slot}:start -->\n\n${content.trim()}\n\n<!-- ${slot}:end -->`,
    ),
  );
}
await fill(
  join(plugin, "skills/show-document/SKILL.md"),
  "showai-system-workflow",
  workflow,
);
await fill(
  join(plugin, "skills/show-visual/SKILL.md"),
  "showai-visual-principles",
  visualPrinciples,
);
await mkdir(join(plugin, ".claude-plugin"), { recursive: true });
const claudeManifestPath = join(plugin, ".claude-plugin/plugin.json");
const existingClaude = await readFile(claudeManifestPath, "utf8").then(
  JSON.parse,
  (error) => {
    if (error.code === "ENOENT") return {};
    throw error;
  },
);
await writeFile(
  claudeManifestPath,
  JSON.stringify(
    {
      ...existingClaude,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      skills: existingClaude.skills ?? "./skills/",
      author: existingClaude.author ?? { name: "ShowAI" },
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  join(plugin, ".mcp.json"),
  JSON.stringify(
    {
      mcpServers: {
        showai: {
          command: "node",
          args: ["${CLAUDE_PLUGIN_ROOT}/mcp/launch.mjs"],
          env: { SHOWAI_HOST_DISPLAY: "model-html" },
        },
      },
    },
    null,
    2,
  ) + "\n",
);

await mkdir(join(plugin, "assets"), { recursive: true });
for (const [source, target] of [
  ["icon.svg", "logo.svg"],
  ["icon-light.svg", "logo-dark.svg"],
])
  await copyFile(
    join(root, "src/desktop/assets", source),
    join(plugin, "assets", target),
  );
const skills = (await readdir(join(plugin, "skills"))).sort();
for (const skill of skills) {
  await access(join(plugin, "skills", skill, "SKILL.md"));
  const source = (
    await readFile(join(plugin, "skills", skill, "SKILL.md"), "utf8")
  ).replace(/\r\n/g, "\n");
  if (
    !source.startsWith("---\n") ||
    !/^name: /m.test(source) ||
    !/^description: /m.test(source)
  )
    throw new Error(`Invalid skill: ${skill}`);
}
async function validateGuidanceLinks(directory, packageRoot = plugin) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await validateGuidanceLinks(path, packageRoot);
    else if (entry.name.endsWith(".md")) {
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const link = match[1];
        if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link)) continue;
        const target = resolve(
          dirname(path),
          decodeURIComponent(link.split("#")[0]),
        );
        const location = relative(packageRoot, target);
        if (
          isAbsolute(location) ||
          location === ".." ||
          location.startsWith(".." + sep)
        )
          throw new Error(
            `Skill reference leaves the plugin: ${relative(plugin, path)} → ${link}`,
          );
        await access(target).catch((error) => {
          throw new Error(
            `Missing skill reference: ${relative(plugin, path)} → ${link}`,
            { cause: error },
          );
        });
      }
    }
  }
}
await validateGuidanceLinks(join(plugin, "skills"));
console.log(
  `Prepared ShowAI MCP plugin ${manifest.version}: ${skills.join(", ")}`,
);
for (const profile of ["codex", "claude", "antigravity"]) {
  const target = join(root, "plugins", `showai-${profile}`);
  await stageHostPlugin({ source: plugin, target, profile });
  await validateGuidanceLinks(join(target, "skills"), target);
}
const kimi = join(root, "plugins/showai-kimi");
const kimiManifestPath = join(kimi, "kimi.plugin.json");
const kimiManifest = JSON.parse(await readFile(kimiManifestPath, "utf8"));
await writeFile(
  kimiManifestPath,
  JSON.stringify({ ...kimiManifest, version: manifest.version }, null, 2) +
    "\n",
);
await bindHostSkills({ source: plugin, target: kimi, profile: "kimi" });
await mkdir(join(kimi, "mcp"), { recursive: true });
await copyFile(join(plugin, "mcp/launch.mjs"), join(kimi, "mcp/launch.mjs"));
await validateGuidanceLinks(join(kimi, "skills"), kimi);
async function publishCompatibilityPackage(source, alias, exclude = []) {
  const target = join(root, alias);
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), ".showai-compat-"));
  try {
    await cp(source, staging, {
      recursive: true,
      filter: (path) =>
        !["node_modules", ...exclude].includes(
          relative(source, path).split(sep)[0],
        ),
    });
    await publishPluginDirectory(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

await publishCompatibilityPackage(kimi, "plugins-kimi/showai");
await publishCompatibilityPackage(
  join(root, "plugins/showai-deepseek"),
  "plugins/dsh-showai",
  ["test"],
);

if (Object.keys(settings).length) {
  if (!settings["--out"])
    throw new Error("Use --out NEW_DIRECTORY_OR_ZIP for a universal plugin.");
  const destination = resolve(settings["--out"]);
  const relativeDestination = relative(plugin, destination);
  if (
    !relativeDestination ||
    (!isAbsolute(relativeDestination) &&
      relativeDestination !== ".." &&
      !relativeDestination.startsWith(".." + sep))
  )
    throw new Error("Package outside the source plugin.");
  const host = settings["--host"];
  const options = {
    name:
      settings["--name"] ??
      (host
        ? `showai-${host}`
        : settings["--mcp-url"]
          ? "showai-cloud"
          : "showai-universal"),
    displayName: settings["--display-name"] ?? (host ? "ShowAI" : undefined),
    appId: settings["--chatgpt-app"],
    setupUrl: settings["--mcp-url"],
    mcp: settings["--mcp"],
    mcpAuth: settings["--mcp-auth"],
    runtimeConfig: settings["--runtime-config"],
    host,
  };
  if (destination.endsWith(".zip")) {
    const bundle = await universalPluginArchive(plugin, options);
    await writeFile(destination, bundle.bytes, { flag: "wx", mode: 0o600 });
  } else {
    const { files } = await universalPluginFiles(plugin, options);
    await mkdir(destination, { recursive: false });
    try {
      for (const [file, contents] of files) {
        const path = join(destination, file);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, contents);
      }
      await validateGuidanceLinks(join(destination, "skills"), destination);
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
  }
  console.log(
    `Prepared ${options.name} in ${destination}. Use the ShowAI connection guide when MCP setup or reconnection is needed.`,
  );
}

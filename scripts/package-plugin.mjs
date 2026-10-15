import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve, join, relative, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseTemplateReadme } from "../src/portable/template-bundle.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "plugins/showai");
const args = process.argv.slice(2);
const settings = {};
for (let i = 0; i < args.length; i += 2) {
  if (
    ![
      "--mcp-url",
      "--out",
      "--name",
      "--display-name",
      "--chatgpt-app",
    ].includes(args[i]) ||
    !args[i + 1]
  )
    throw new Error(
      "Usage: package-plugin.mjs [--mcp-url HTTPS_MCP_URL --out NEW_PACKAGE_DIRECTORY [--name PLUGIN_NAME] [--display-name NAME] [--chatgpt-app asdk_app_ID]]",
    );
  settings[args[i]] = args[i + 1];
}
// Remove only generated files from the previous runtime distribution layout.
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
const baseline = parseTemplateReadme(
  await readFile(
    join(root, "resources/templates/system-presentation/README.md"),
    "utf8",
  ),
).body;
const baselineHash = createHash("sha256").update(baseline).digest("hex");
const entrypoint = join(plugin, "skills/show-document/SKILL.md");
const entrySource = await readFile(entrypoint, "utf8");
if (
  !entrySource.includes("<!-- showai-system-baseline:start -->") ||
  !entrySource.includes("<!-- showai-system-baseline:end -->")
)
  throw new Error(
    "Foundational presentation skill is missing its mandatory system baseline slot.",
  );
await writeFile(
  entrypoint,
  entrySource.replace(
    /<!-- showai-system-baseline:start -->[\s\S]*?<!-- showai-system-baseline:end -->/,
    `<!-- showai-system-baseline:start -->\n${baseline}\n\n系统基线内容哈希：\`${baselineHash}\`。本轮已读到同一内容时，可用 knownSystemHash 避免重复返回；没有读过时不要仅凭哈希声明已知。\n<!-- showai-system-baseline:end -->`,
  ),
);
// Host packaging differs; skills, system rules and the MCP runtime remain shared.
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
        },
      },
    },
    null,
    2,
  ) + "\n",
);
if (manifest.apps)
  throw new Error("Use an explicit MCP URL when packaging remote connections.");
// Keep plugin branding identical to the application's theme-specific icons.
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
// Relative guidance must ship with the skill, including links across skills.
async function validateGuidanceLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await validateGuidanceLinks(path);
    else if (entry.name.endsWith(".md")) {
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const link = match[1];
        if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link)) continue;
        const target = resolve(
          dirname(path),
          decodeURIComponent(link.split("#")[0]),
        );
        const location = relative(plugin, target);
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
if (settings["--mcp-url"] || settings["--out"]) {
  if (!settings["--mcp-url"] || !settings["--out"])
    throw new Error("Remote packaging requires both --mcp-url and --out.");
  const url = new URL(settings["--mcp-url"]);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use a public HTTPS MCP URL without credentials or query parameters.",
    );
  const destination = resolve(settings["--out"]);
  const relativeDestination = relative(plugin, destination);
  if (
    !relativeDestination ||
    (!isAbsolute(relativeDestination) &&
      relativeDestination !== ".." &&
      !relativeDestination.startsWith(".." + sep))
  )
    throw new Error("Package outside the source plugin.");
  const name = settings["--name"] ?? `${manifest.name}-cloud`;
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name))
    throw new Error("Use a lowercase plugin name such as showai-cloud.");
  const app = settings["--chatgpt-app"];
  if (app !== undefined && !/^asdk_app_[A-Za-z0-9]+$/.test(app))
    throw new Error(
      "--chatgpt-app takes the asdk_app_… ID of the ChatGPT connection.",
    );
  await mkdir(destination, { recursive: false });
  // The local stdio launcher does not belong in a package for a remote server.
  await cp(plugin, destination, {
    recursive: true,
    errorOnExist: true,
    filter: (source) => relative(plugin, source).split(sep)[0] !== "mcp",
  });
  // A distinct name lets the remote package sit beside the local plugin.
  const remote = structuredClone(manifest);
  remote.name = name;
  const openai = remote.extensions["com.openai"];
  Object.assign(openai.interface, {
    displayName:
      settings["--display-name"] ?? `${openai.interface.displayName} Cloud`,
    shortDescription: "Create and present ShowAI pages in your cloud projects",
    longDescription:
      "Operate ShowAI through its remote MCP server. Sign in with a ShowAI Server account to read, create and present pages in authorized cloud projects; public components, templates and standalone rendering need no account.",
  });
  // Replace the local stdio server declaration copied from the source plugin.
  await rm(join(destination, "mcp.json"));
  if (app) {
    // ChatGPT reaches the server through its registered connection.
    openai.apps = "./.app.json";
    await writeFile(
      join(destination, ".app.json"),
      JSON.stringify({ apps: { [name]: { id: app } } }, null, 2) + "\n",
    );
  } else
    await writeFile(
      join(destination, "mcp.json"),
      JSON.stringify(
        {
          $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
          mcpServers: {
            showai: {
              type: "streamable-http",
              url: url.href,
              // Public tools work anonymously; private projects use OAuth with
              // dynamic client registration.
              extensions: {
                "com.openai": {
                  auth: { type: "mixed", client: { mode: "dcr" } },
                },
              },
            },
          },
        },
        null,
        2,
      ) + "\n",
    );
  await writeFile(
    join(destination, "plugin.json"),
    JSON.stringify(remote, null, 2) + "\n",
  );
  await writeFile(
    join(destination, "README.md"),
    `# ShowAI Cloud plugin

This package connects the ShowAI skills to the remote MCP server at ${url.href}. It has no local launcher and reads no content library on this computer.

Public components, templates and standalone rendering work without an account. Private projects require signing in with an existing ShowAI Server account (GitHub, Google or account password) and granting access to one project or to every project the account can reach. Projects created on a computer appear here after they synchronize to the same server account.

${app ? `ChatGPT reaches the server through its registered connection \`${app}\`.` : "Hosts connect to the server directly and use OAuth with dynamic client registration."} Read [use-showai](skills/use-showai/SKILL.md) for connection identity, project selection and task routing; the remote rules are in [connection setup](skills/use-showai/references/runtime.md#远程). No credentials enter the bundle.
`,
  );
  if (app) {
    // A ChatGPT package reaches the server only through the registered
    // connection; ChatGPT treats any server it would have to run itself as
    // desktop-only. The Claude Code manifests do not apply there.
    await rm(join(destination, ".claude-plugin"), { recursive: true });
    await rm(join(destination, ".mcp.json"));
  } else {
    const claude = JSON.parse(
      await readFile(join(destination, ".claude-plugin/plugin.json"), "utf8"),
    );
    await writeFile(
      join(destination, ".claude-plugin/plugin.json"),
      JSON.stringify({ ...claude, name }, null, 2) + "\n",
    );
    await writeFile(
      join(destination, ".mcp.json"),
      JSON.stringify(
        { mcpServers: { showai: { type: "http", url: url.href } } },
        null,
        2,
      ) + "\n",
    );
  }
  console.log(`Prepared remote plugin from the same skills: ${destination}`);
}

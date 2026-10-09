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
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "plugins/showai");
const args = process.argv.slice(2);
const settings = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--mcp-url", "--out"].includes(args[i]) || !args[i + 1])
    throw new Error(
      "Usage: package-plugin.mjs [--mcp-url HTTPS_MCP_URL --out NEW_PACKAGE_DIRECTORY]",
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
  await mkdir(destination, { recursive: false });
  await cp(plugin, destination, { recursive: true, errorOnExist: true });
  await writeFile(
    join(destination, "mcp.json"),
    JSON.stringify(
      {
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: { showai: { type: "streamable-http", url: url.href } },
      },
      null,
      2,
    ) + "\n",
    { flag: "w" },
  );
  console.log(`Prepared remote plugin from the same skills: ${destination}`);
}

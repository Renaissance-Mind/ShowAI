import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "plugins/showai");
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
if (manifest.mcpServers || manifest.apps)
  throw new Error("The ShowAI plugin distributes skills only.");
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
  `Prepared skills-only ShowAI plugin ${manifest.version}: ${skills.join(", ")}`,
);

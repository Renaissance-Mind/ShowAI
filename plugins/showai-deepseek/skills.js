import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROVIDER_NAME = "showai";
const RANK = 600;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseSkill(text) {
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error("SKILL.md has no frontmatter");
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (field) fields[field[1]] = field[2].trim();
  }
  if (!SKILL_NAME.test(fields.name ?? "") || !fields.description)
    throw new Error("SKILL.md needs a kebab-case name and a description");
  return {
    name: fields.name,
    description: fields.description,
    body: text.slice(match[0].length),
  };
}

export function createProvider(root) {
  const candidate = (directory, skill) => {
    const path = join(root, directory, "SKILL.md");
    return {
      name: skill.name,
      description: skill.description,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: PROVIDER_NAME,
      source: "bundled",
      resourceBase: { kind: "directory", path: join(root, directory) },
      rank: RANK,
      path,
      locator: path,
    };
  };
  return {
    name: PROVIDER_NAME,
    async list() {
      const entries = await readdir(root, { withFileTypes: true });
      const skills = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const text = await readFile(join(root, entry.name, "SKILL.md"), "utf8");
        skills.push(candidate(entry.name, parseSkill(text)));
      }
      return skills;
    },
    async get(found) {
      const skill = parseSkill(await readFile(found.locator, "utf8"));
      return {
        name: skill.name,
        description: skill.description,
        invocation: found.invocation,
        provider: PROVIDER_NAME,
        source: found.source,
        resourceBase: found.resourceBase,
        path: found.path,
        content: skill.body,
      };
    },
  };
}

export const name = "showai-skills";
export const inject = ["skills"];

export function apply(ctx) {
  const root = fileURLToPath(new URL("./skills/", import.meta.url));
  ctx.skills.registerProvider(() => createProvider(root));
}

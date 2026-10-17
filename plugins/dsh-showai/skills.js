/**
 * ShowAI Skills — Host skill provider.
 *
 * The staged bundle carries the ShowAI agent Skills under `./skills/<name>/SKILL.md`
 * (copied from the canonical `plugins/showai/skills` when the bundle is staged).
 * This provider publishes them to the Harness skill registry at the bundled rank,
 * so installing the bundle is enough; nothing is copied into `$DSH_HOME/skills`.
 * Hand-copied user skills of the same name rank higher and shadow these, so a
 * stale copy there must be removed when switching to the bundle.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Provider name; candidates must carry it. */
export const PROVIDER_NAME = "showai";
/** Same rank as Harness-bundled skills (`BUNDLED_SKILL_RANK`), below user and project roots. */
const RANK = 600;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Split a SKILL.md into its single-line frontmatter fields and body.
 * @param text - the SKILL.md source.
 * @returns name, description and the body without frontmatter.
 */
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

/**
 * Create the provider over one skills directory.
 * @param root - directory holding `<name>/SKILL.md` bundles.
 * @returns a Harness skill provider.
 */
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

/** Cordis plugin name. */
export const name = "showai-skills";
/** Service required by the provider. */
export const inject = ["skills"];

/**
 * Register the ShowAI skill provider on `ctx.skills`.
 * @param ctx - the plugin context.
 */
export function apply(ctx) {
  const root = fileURLToPath(new URL("./skills/", import.meta.url));
  ctx.skills.registerProvider(() => createProvider(root));
}

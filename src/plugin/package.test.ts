import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const execute = promisify(execFile);
const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function packageSkill(source: string) {
  const fixture = await mkdtemp(join(tmpdir(), "showai-plugin-package-"));
  fixtures.push(fixture);
  await Promise.all(
    ["scripts", "src/desktop/assets", "plugins/showai/skills/example"].map(
      (path) => mkdir(join(fixture, path), { recursive: true }),
    ),
  );
  await copyFile(
    join(root, "scripts/package-plugin.mjs"),
    join(fixture, "scripts/package-plugin.mjs"),
  );
  await Promise.all([
    writeFile(join(fixture, "src/desktop/assets/icon.svg"), "<svg/>"),
    writeFile(join(fixture, "src/desktop/assets/icon-light.svg"), "<svg/>"),
    writeFile(
      join(fixture, "plugins/showai/plugin.json"),
      JSON.stringify({ name: "showai", version: "0.8.0" }),
    ),
    writeFile(join(fixture, "plugins/showai/skills/example/SKILL.md"), source),
  ]);
  return execute(process.execPath, [
    join(fixture, "scripts/package-plugin.mjs"),
  ]);
}

describe("plugin packaging", () => {
  it.each(["\n", "\r\n"])(
    "accepts skill frontmatter with %j line endings",
    async (eol) => {
      const result = await packageSkill(
        [
          "---",
          "name: example",
          "description: Example skill.",
          "---",
          "Body.",
        ].join(eol),
      );
      expect(result.stdout).toContain("Prepared skills-only ShowAI plugin");
    },
  );

  it("still rejects missing required frontmatter", async () => {
    await expect(
      packageSkill("---\r\nname: example\r\n---\r\nBody."),
    ).rejects.toThrow("Invalid skill: example");
  });
});

import { execFile } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function packageSkill(
  source: string,
  references: Record<string, string> = {},
) {
  const fixture = await mkdtemp(join(tmpdir(), "showai-plugin-package-"));
  fixtures.push(fixture);
  await Promise.all(
    [
      "scripts",
      "src/desktop/assets",
      "src/portable",
      "src/plugin",
      "plugins-kimi/showai",
      "resources/templates/system-presentation",
      "plugins/showai/skills/show-document",
      "plugins/showai/skills/example",
      "plugins/showai/skills/use-showai/references",
      "plugins/showai/mcp",
    ].map((path) => mkdir(join(fixture, path), { recursive: true })),
  );
  await copyFile(
    join(root, "scripts/package-plugin.mjs"),
    join(fixture, "scripts/package-plugin.mjs"),
  );
  await cp(
    join(root, "plugins/showai/host-adapters"),
    join(fixture, "plugins/showai/host-adapters"),
    { recursive: true },
  );
  await copyFile(
    join(root, "plugins-kimi/showai/kimi.plugin.json"),
    join(fixture, "plugins-kimi/showai/kimi.plugin.json"),
  );
  await copyFile(
    join(root, "src/plugin/host-package.mjs"),
    join(fixture, "src/plugin/host-package.mjs"),
  );
  await copyFile(
    join(root, "plugins/showai/mcp/launch.mjs"),
    join(fixture, "plugins/showai/mcp/launch.mjs"),
  );
  await copyFile(
    join(root, "plugins/showai/skills/use-showai/references/host-adapter.md"),
    join(
      fixture,
      "plugins/showai/skills/use-showai/references/host-adapter.md",
    ),
  );
  await copyFile(
    join(root, "src/portable/template-bundle.mjs"),
    join(fixture, "src/portable/template-bundle.mjs"),
  );
  await copyFile(
    join(root, "resources/templates/system-presentation/README.md"),
    join(fixture, "resources/templates/system-presentation/README.md"),
  );
  await Promise.all([
    writeFile(
      join(fixture, "plugins/showai/skills/use-showai/SKILL.md"),
      "---\nname: use-showai\ndescription: Connection instructions.\n---\nRead [host](references/host-adapter.md).\n",
    ),
    writeFile(
      join(fixture, "plugins/showai/skills/show-document/SKILL.md"),
      "---\nname: show-document\ndescription: Foundational presentation instructions.\n---\n<!-- showai-system-baseline:start -->\n<!-- showai-system-baseline:end -->\n",
    ),
    writeFile(join(fixture, "src/desktop/assets/icon.svg"), "<svg/>"),
    writeFile(join(fixture, "src/desktop/assets/icon-light.svg"), "<svg/>"),
    writeFile(
      join(fixture, "plugins/showai/plugin.json"),
      JSON.stringify({ name: "showai", version: "0.8.0" }),
    ),
    writeFile(join(fixture, "plugins/showai/skills/example/SKILL.md"), source),
    ...Object.entries(references).map(async ([name, contents]) => {
      const path = join(fixture, "plugins/showai/skills/example", name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents);
    }),
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
      expect(result.stdout).toContain(
        "Prepared ShowAI MCP plugin 0.8.0: example, show-document, use-showai",
      );
    },
  );

  it("still rejects missing required frontmatter", async () => {
    await expect(
      packageSkill("---\r\nname: example\r\n---\r\nBody."),
    ).rejects.toThrow("Invalid skill: example");
  });

  it("ships linked guidance and rejects missing references", async () => {
    const skill =
      "---\nname: example\ndescription: Example skill.\n---\nRead [guide](references/use.md).";
    await expect(packageSkill(skill)).rejects.toThrow(
      "Missing skill reference",
    );
    await expect(
      packageSkill(skill, { "references/use.md": "Guidance." }),
    ).resolves.toBeDefined();
  });

  it("rejects a skill link that relies on files outside the plugin", async () => {
    await expect(
      packageSkill(
        "---\nname: example\ndescription: Example skill.\n---\nRead [local](../../../../private.md).",
      ),
    ).rejects.toThrow("Skill reference leaves the plugin");
  });
});

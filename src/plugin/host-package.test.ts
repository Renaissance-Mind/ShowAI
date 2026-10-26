import { afterEach, describe, expect, test } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  bindHostSkills,
  HOST_GUIDE,
  HOST_PROFILES,
  skillFiles,
  stageHostPlugin,
} from "./host-package.mjs";

const source = resolve("plugins/showai");
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "showai-host-package-"));
  temporary.push(path);
  return path;
}

describe("host-specific plugin distributions", () => {
  test("committed marketplace and Kimi packages match their single shared source", async () => {
    const common = Object.fromEntries(
      Object.entries(await skillFiles(join(source, "skills"))).filter(
        ([name]) => name !== HOST_GUIDE,
      ),
    );
    const version = JSON.parse(
      await readFile(join(source, "plugin.json"), "utf8"),
    ).version;
    for (const [profile, target] of [
      ["codex", resolve("plugins/showai-codex")],
      ["claude", resolve("plugins/showai-claude")],
      ["kimi", resolve("plugins-kimi/showai")],
    ]) {
      const files = await skillFiles(join(target, "skills"));
      expect(
        Object.fromEntries(
          Object.entries(files).filter(([name]) => name !== HOST_GUIDE),
        ),
      ).toEqual(common);
      expect(await readFile(join(target, "skills", HOST_GUIDE), "utf8")).toBe(
        await readFile(join(source, "host-adapters", `${profile}.md`), "utf8"),
      );
      expect(
        JSON.parse(await readFile(join(target, "host-profile.json"), "utf8")),
      ).toMatchObject({ profile, commonVersion: version, commonFiles: common });
    }
    expect(
      await readFile(resolve("plugins-kimi/showai/mcp/launch.mjs"), "utf8"),
    ).toBe(await readFile(join(source, "mcp/launch.mjs"), "utf8"));
    expect(
      JSON.parse(
        await readFile(resolve("plugins-kimi/showai/kimi.plugin.json"), "utf8"),
      ).version,
    ).toBe(version);
  });
  test("all profiles share identical workflows, bind only their own guide and remove stale skills", async () => {
    const target = await directory();
    const original = await skillFiles(join(source, "skills"));
    const common = Object.fromEntries(
      Object.entries(original).filter(([name]) => name !== HOST_GUIDE),
    );
    for (const profile of Object.keys(
      HOST_PROFILES,
    ) as (keyof typeof HOST_PROFILES)[]) {
      await mkdir(join(target, "skills/stale"), { recursive: true });
      await writeFile(join(target, "skills/stale/SKILL.md"), "old workflow");
      const receipt = await bindHostSkills({ source, target, profile });
      const actual = await skillFiles(join(target, "skills"));
      expect(
        Object.fromEntries(
          Object.entries(actual).filter(([name]) => name !== HOST_GUIDE),
        ),
      ).toEqual(common);
      expect(receipt.commonFiles).toEqual(common);
      const adapter = await readFile(
        join(target, "skills", HOST_GUIDE),
        "utf8",
      );
      expect(adapter).toBe(
        await readFile(join(source, "host-adapters", `${profile}.md`), "utf8"),
      );
      if (profile !== "codex") expect(adapter).not.toContain("visualize");
      expect((await readdir(join(target, "skills"))).sort()).toEqual(
        (await readdir(join(source, "skills"))).sort(),
      );
      expect(await bindHostSkills({ source, target, profile })).toEqual(
        receipt,
      );
    }
    expect(await skillFiles(join(source, "skills"))).toEqual(original);
  });

  test.each(["codex", "claude"] as const)(
    "%s has only its own launch manifest and survives regeneration",
    async (profile) => {
      const target = join(await directory(), "plugin");
      const first = await stageHostPlugin({ source, target, profile });
      const manifest = profile === "codex" ? "mcp.json" : ".mcp.json";
      const launch = JSON.parse(await readFile(join(target, manifest), "utf8"))
        .mcpServers.showai;
      expect(launch.env.SHOWAI_HOST_DISPLAY).toBe(first.declaredHostDisplay);
      expect(await readdir(target)).not.toContain(
        profile === "codex" ? ".mcp.json" : "mcp.json",
      );
      expect(await readdir(target)).not.toContain("host-adapters");
      expect(await stageHostPlugin({ source, target, profile })).toEqual(first);
    },
  );

  test("rejects an unrelated destination and never rebinds the common source", async () => {
    const target = await directory();
    await writeFile(join(target, "keep.txt"), "user content");
    await expect(
      stageHostPlugin({ source, target, profile: "codex" }),
    ).rejects.toThrow("non-generated");
    expect(await readFile(join(target, "keep.txt"), "utf8")).toBe(
      "user content",
    );
    await expect(
      bindHostSkills({ source, target: source, profile: "codex" }),
    ).rejects.toThrow("common source");
    await expect(
      stageHostPlugin({
        source,
        target: join(source, "nested"),
        profile: "codex",
      }),
    ).rejects.toThrow("outside");
  });
});

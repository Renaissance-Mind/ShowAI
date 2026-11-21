import { createHash } from "node:crypto";
import { afterEach, describe, expect, test } from "vitest";
import {
  mkdir,
  cp,
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

async function expectedWorkflowHashes(
  common: Record<string, string>,
  profile: string,
) {
  const expected = { ...common };
  const adapter = await readFile(
    join(source, "host-adapters", profile + ".md"),
    "utf8",
  );
  const slot =
    /<!-- showai-host-delivery:start -->[\s\S]*?<!-- showai-host-delivery:end -->/;
  const delivery = adapter.match(slot)?.[0];
  expect(delivery).toBeTruthy();
  for (const file of ["show-visual/SKILL.md", "show-document/SKILL.md"]) {
    const commonWorkflow = await readFile(join(source, "skills", file), "utf8");
    expect(commonWorkflow).toMatch(slot);
    const bound = commonWorkflow.replace(slot, () => delivery!);
    expected[file] = createHash("sha256").update(bound).digest("hex");
  }
  const noteName =
    profile === "codex"
      ? "codex-entry.md"
      : profile === "antigravity"
        ? "antigravity-entry.md"
        : undefined;
  if (!noteName) return expected;
  const entry = "use-showai/SKILL.md";
  const original = await readFile(join(source, "skills", entry), "utf8");
  const note = await readFile(
    join(source, "host-adapters", noteName),
    "utf8",
  );
  const bound = original.trimEnd() + "\n\n" + note;
  return {
    ...expected,
    [entry]: createHash("sha256").update(bound).digest("hex"),
  };
}

describe("host-specific plugin distributions", () => {
  test("committed marketplace and Kimi packages match their single shared source", async () => {
    const codexConfig = JSON.parse(
      await readFile(resolve("plugins/showai-codex/mcp.json"), "utf8"),
    );
    expect(codexConfig.mcpServers.showai.env.SHOWAI_HOST_DISPLAY).toBe(
      "mcp-app",
    );
    expect(HOST_PROFILES.codex).toBe("mcp-app");
    expect(HOST_PROFILES.antigravity).toBe("mcp-app");
    const antigravityConfig = JSON.parse(
      await readFile(resolve("plugins/showai-antigravity/mcp_config.json"), "utf8"),
    );
    expect(antigravityConfig.mcpServers.showai.env).toMatchObject({
      SHOWAI_HOST_DISPLAY: "mcp-app",
      SHOWAI_ANTIGRAVITY_WORKBENCH: "1",
    });
    const common = Object.fromEntries(
      Object.entries(await skillFiles(join(source, "skills"))).filter(
        ([name]) => name !== HOST_GUIDE,
      ),
    );
    const sharedLauncher = await readFile(
      join(source, "mcp/launch.mjs"),
      "utf8",
    );
    expect(sharedLauncher).not.toContain("SHOWAI_CODEX_WORKBENCH_PROFILE");
    const version = JSON.parse(
      await readFile(join(source, "plugin.json"), "utf8"),
    ).version;
    for (const [profile, target] of [
      ["codex", resolve("plugins/showai-codex")],
      ["claude", resolve("plugins/showai-claude")],
      ["antigravity", resolve("plugins/showai-antigravity")],
      ["kimi", resolve("plugins-kimi/showai")],
    ]) {
      const files = await skillFiles(join(target, "skills"));
      const launcher = await readFile(join(target, "mcp/launch.mjs"), "utf8");
      expect(launcher).not.toContain("__SHOWAI_PROBE_CACHE_PATH__");
      if (profile === "codex")
        expect(launcher).toContain("SHOWAI_CODEX_WORKBENCH_PROFILE");
      else if (profile === "antigravity")
        expect(launcher).toContain(
          "Antigravity replaces the plugin directory in place",
        );
      else expect(launcher).toBe(sharedLauncher);
      expect(
        Object.fromEntries(
          Object.entries(files).filter(([name]) => name !== HOST_GUIDE),
        ),
      ).toEqual(await expectedWorkflowHashes(common, profile));
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
  test("each profile binds its delivery steps in both workflows and removes stale skills", async () => {
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
      ).toEqual(await expectedWorkflowHashes(common, profile));
      expect(receipt.commonFiles).toEqual(common);
      expect(receipt.workflowFiles).toEqual({
        "show-document/SKILL.md": actual["show-document/SKILL.md"],
        "show-visual/SKILL.md": actual["show-visual/SKILL.md"],
      });
      const adapter = await readFile(
        join(target, "skills", HOST_GUIDE),
        "utf8",
      );
      expect(adapter).toBe(
        await readFile(join(source, "host-adapters", `${profile}.md`), "utf8"),
      );
      expect(adapter.includes("引用到 Codex 对话")).toBe(profile === "codex");
      const entrySkill = await readFile(
        join(target, "skills/use-showai/SKILL.md"),
        "utf8",
      );
      expect(entrySkill.includes("## Codex 工作台")).toBe(profile === "codex");
      expect(entrySkill.includes("`card_present`")).toBe(
        profile === "codex" || profile === "antigravity",
      );
      expect(entrySkill.includes("## Antigravity 工作台与页面卡片")).toBe(
        profile === "antigravity",
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

  test.each(["codex", "claude", "antigravity"] as const)(
    "%s has only its own launch manifest and survives regeneration",
    async (profile) => {
      const target = join(await directory(), "plugin");
      const first = await stageHostPlugin({ source, target, profile });
      const manifest =
        profile === "codex"
          ? "mcp.json"
          : profile === "claude"
            ? ".mcp.json"
            : "mcp_config.json";
      const launch = JSON.parse(await readFile(join(target, manifest), "utf8"))
        .mcpServers.showai;
      expect(launch.env.SHOWAI_HOST_DISPLAY).toBe(first.declaredHostDisplay);
      if (profile === "antigravity") {
        expect(launch.tools).toEqual({
          public_catalog_list: { eager: true },
          public_catalog_describe: { eager: true },
          show_component: { eager: true },
        });
      } else expect(launch.tools).toBeUndefined();
      for (const other of ["mcp.json", ".mcp.json", "mcp_config.json"].filter(
        (name) => name !== manifest,
      ))
        expect(await readdir(target)).not.toContain(other);
      expect(await readdir(target)).not.toContain("host-adapters");
      if (profile === "antigravity") {
        expect(launch.env.SHOWAI_ANTIGRAVITY_WORKBENCH).toBe("1");
        const pluginEntries = await readdir(target);
        expect(pluginEntries).not.toContain("hooks");
        expect(pluginEntries).not.toContain("hooks.json");
        const pluginManifest = JSON.parse(
          await readFile(join(target, "plugin.json"), "utf8"),
        );
        expect(pluginManifest).toMatchObject({
          name: "showai",
          displayName: "ShowAI",
          logo: "assets/logo.svg",
        });
        expect(pluginManifest.$schema).toBeUndefined();
        expect(pluginManifest.extensions).toBeUndefined();
        expect(pluginManifest.suggestedPrompts).toHaveLength(3);
        const sidecar = JSON.parse(
          await readFile(join(target, "sidecars/workbench/sidecar.json"), "utf8"),
        );
        expect(sidecar).toMatchObject({
          has_web_ui: true,
          display_name: "ShowAI",
          ui_config: {
            views: [{ entrypoint: "SIDECAR_UI_ENTRYPOINT_AUX_PANE", path: "/" }],
          },
        });
      }
      expect(await stageHostPlugin({ source, target, profile })).toEqual(first);
    },
  );

  test("a failed rebuild keeps the previous working package", async () => {
    const dir = await directory();
    const inputs = join(dir, "inputs"),
      target = join(dir, "packaged");
    await cp(source, inputs, { recursive: true });
    await stageHostPlugin({ source: inputs, target, profile: "codex" });
    const before = await skillFiles(target);
    await rm(join(inputs, "host-adapters/codex-entry.md"));
    await expect(
      stageHostPlugin({ source: inputs, target, profile: "codex" }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await skillFiles(target)).toEqual(before);
  });

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

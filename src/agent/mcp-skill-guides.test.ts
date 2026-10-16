import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { mcpSkillSourceModule } from "../../scripts/mcp-skill-source.mjs";
import { mcpSkillSources } from "./mcp-skill-source.generated";
import {
  mcpSkillGuide,
  mcpSkillNames,
  remoteSkillInstructions,
} from "./mcp-skill-guides";

describe("remote shared Skill guides", () => {
  it("embeds the canonical plugin sources and includes every supporting file", async () => {
    expect(
      await readFile(
        resolve("src/agent/mcp-skill-source.generated.ts"),
        "utf8",
      ),
    ).toBe(await mcpSkillSourceModule());
    for (const [path, source] of Object.entries(mcpSkillSources)) {
      expect(source).toBe(
        await readFile(resolve("plugins/showai/skills", path), "utf8"),
      );
      const [skill, ...parts] = path.split("/");
      const result = mcpSkillGuide({ skill, file: parts.join("/") });
      expect(result.source.hash).toBe(
        createHash("sha256").update(source).digest("hex"),
      );
      for (const link of result.links) {
        const linked = mcpSkillGuide(link.arguments);
        expect(linked.markdown).toBeTruthy();
      }
    }
  });

  it("routes all shared workflows and reads the connection entry without a plugin", () => {
    const result = mcpSkillGuide();
    expect(result.entrypoint).toBe(true);
    expect(result.markdown).toContain("首次实际操作");
    expect(result.skills?.map((skill) => skill.name).sort()).toEqual(
      [...mcpSkillNames].sort(),
    );
    expect(result.routing?.map((route) => route.skill).sort()).toEqual(
      [...mcpSkillNames].sort(),
    );
    expect(remoteSkillInstructions.slice(0, 512)).toContain("guide()");
    expect(remoteSkillInstructions).toContain("partial presentation");
    expect(result.context.projects).toBe("authorized");
    expect(result.context.rules.join(" ")).toContain("remote branches");
  });

  it("discloses the same file only when its exact hash is not already known", () => {
    const full = mcpSkillGuide({ skill: "show-document" });
    const cached = mcpSkillGuide({
      skill: "show-document",
      knownHash: full.hash,
    });
    expect(cached.unchanged).toBe(true);
    expect(cached).not.toHaveProperty("markdown");
    expect(cached.links).toEqual(full.links);
    expect(
      mcpSkillGuide({ skill: "use-showai", knownHash: full.hash }).markdown,
    ).toBeTruthy();
  });

  it("converts cross-skill links and section hints into callable guide references", () => {
    const entry = mcpSkillGuide();
    const remote = entry.links.find(
      (link) => link.arguments.section === "远程",
    )!;
    expect(remote.arguments).toEqual({
      skill: "use-showai",
      file: "references/runtime.md",
      section: "远程",
    });
    const runtime = mcpSkillGuide(remote.arguments);
    expect(runtime.requestedSection).toBe("远程");
    expect(runtime.markdown).toContain("## 远程");
    expect(entry.markdown).not.toMatch(/\]\((?:\.\.\/|references\/)/);
    const planning = mcpSkillGuide({ skill: "plan-presentation" });
    expect(
      planning.files.some((file) => file.file === "scripts/check_plan.py"),
    ).toBe(true);
    expect(
      mcpSkillGuide({
        skill: "plan-presentation",
        file: "scripts/check_plan.py",
      }).markdown,
    ).toContain("argparse");
  });

  it("rejects unbundled files and paths rather than reading the server filesystem", () => {
    for (const file of [
      "../use-showai/SKILL.md",
      "/etc/passwd",
      "references/../../../package.json",
      "references\\runtime.md",
      "references/missing.md",
    ])
      expect(() => mcpSkillGuide({ skill: "use-showai", file })).toThrow(
        /Unknown skill file/,
      );
    expect(() => mcpSkillGuide({ skill: "not-a-skill" })).toThrow(
      /Unknown ShowAI skill/,
    );
  });
});

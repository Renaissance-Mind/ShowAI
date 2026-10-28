import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// The contributing guides and the repository Skill name many source paths.
// These checks keep those paths, links and the two Skill copies current.
const skills = [
  ".agents/skills/showai-contributing/SKILL.md",
  ".claude/skills/showai-contributing/SKILL.md",
];
const guides = [
  "CONTRIBUTING.md",
  "docs/i18n/CONTRIBUTING.zh-CN.md",
  "docs/contributing-components.md",
  "docs/i18n/contributing-components.zh-CN.md",
  "docs/contributing-templates.md",
  "docs/i18n/contributing-templates.zh-CN.md",
  "docs/development.md",
  "docs/i18n/development.zh-CN.md",
];
const files = [...skills, ...guides];
const read = (path: string) => readFileSync(path, "utf8");

// GitHub heading anchors: lower case, punctuation removed, spaces to hyphens.
const anchor = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
const anchors = (path: string) =>
  new Set(
    [...read(path).matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) =>
      anchor(match[1]),
    ),
  );

describe("contributing guides and Skill", () => {
  it("ships the same Skill to Claude Code and Codex", () => {
    expect(read(skills[1])).toBe(read(skills[0]));
    const frontmatter = read(skills[0]).match(/^---\n([\s\S]*?)\n---\n/)![1];
    expect(frontmatter).toMatch(/^name: showai-contributing$/m);
    const description = frontmatter.match(/^description: (.+)$/m)![1];
    expect(description.length).toBeLessThanOrEqual(1024);
  });

  it("keeps every guide and Skill file out of .gitignore", () => {
    const ignored = files.filter((path) => {
      try {
        execFileSync("git", ["check-ignore", "-q", "--no-index", path]);
        return true;
      } catch (error) {
        if ((error as { status?: number }).status === 1) return false;
        throw error;
      }
    });
    expect(ignored).toEqual([]);
  });

  it("names only source paths that exist", () => {
    const missing = files.flatMap((path) =>
      [...read(path).matchAll(/`([^`\s]+)`/g)]
        .map((match) => match[1])
        .filter(
          (token) =>
            /^(?:src|docs|plugins|plugins-kimi|resources|scripts|\.github|\.agents|\.claude)\//.test(
              token,
            ) && !/[<*]|TOPIC/.test(token),
        )
        .filter((token) => !existsSync(token))
        .map((token) => `${path}: ${token}`),
    );
    expect(missing).toEqual([]);
  });

  it("links only to files and headings that exist", () => {
    const broken = guides.flatMap((path) =>
      [...read(path).matchAll(/\]\(([^)\s]+)\)/g)]
        .map((match) => match[1])
        .filter((target) => !/^[a-z]+:/.test(target))
        .filter((target) => {
          const [file, hash] = target.split("#");
          const resolved = file ? join(dirname(path), file) : path;
          if (!existsSync(resolved)) return true;
          return (
            !!hash && resolved.endsWith(".md") && !anchors(resolved).has(hash)
          );
        })
        .map((target) => `${path}: ${target}`),
    );
    expect(broken).toEqual([]);
  });
});

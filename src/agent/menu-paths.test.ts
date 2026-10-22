import { expect, test } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import settings from "../i18n/messages/settings";

const repository = resolve(__dirname, "../..");

async function markdownFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    else if (entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

/** Settings sections as the workbench names them, in both languages. */
function sectionNames() {
  const names = new Set<string>();
  for (const catalog of Object.values(settings.catalogs) as Record<
    string,
    string
  >[])
    for (const [key, value] of Object.entries(catalog))
      if (key.startsWith("section.")) names.add(value);
  return names;
}

/**
 * Agent guides, skills and repository docs tell people where to click. Every
 * 「设置 → X」 / "Settings → X" they mention must name a real Settings section.
 */
test("menu paths in guides, skills and docs name real Settings sections", async () => {
  const sources = [
    join(repository, "src/agent/guides.ts"),
    ...(await markdownFiles(join(repository, "plugins/showai/skills"))),
    ...(await markdownFiles(join(repository, "docs"))),
    join(repository, "plugins/showai/README.md"),
    join(repository, "plugins/showai/README.zh-CN.md"),
  ];
  const sections = sectionNames();
  const unknown: string[] = [];
  let checked = 0;
  for (const path of sources) {
    const text = await readFile(path, "utf8");
    // The section ends at the next arrow, closing mark, bracket or sentence punctuation.
    for (const match of text.matchAll(
      /(System |系统)?(?:设置|Settings)\s*(?:→|>)\s*(?:\*\*)?([^→>*」』”"'`)(（,，。.;；:：\n|]+)/g,
    )) {
      if (match[1]) continue; // macOS System Settings / 系统设置
      const section = match[2].trim();
      checked++;
      if (!sections.has(section))
        unknown.push(`${path.slice(repository.length + 1)}: ${section}`);
    }
  }
  expect(checked).toBeGreaterThan(10);
  expect(unknown).toEqual([]);
});

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { getGuide, GUIDE_TOPICS } from "./guides";

test("installed Skill operation formats retain the runtime's exact contracts", async () => {
  for (const topic of GUIDE_TOPICS) {
    const guide = getGuide(topic);
    const input = "input" in guide ? guide.input : undefined;
    if (!input) continue;
    const source = await readFile(
      join("plugins/showai/skills/use-showai/references/formats", `${topic}.json`),
      "utf8",
    );
    expect(JSON.parse(source)).toEqual(input);
  }
});

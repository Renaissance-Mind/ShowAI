import { describe, expect, it } from "vitest";
import {
  defaultFolderIconGroups,
  folderIconGroups,
  folderPresetSource,
  parseFolderIconGroups,
} from "./folder-icon-presets";

describe("folder icon presets", () => {
  it("provides three distinct groups with unique preset ids", () => {
    expect(folderIconGroups.map((group) => group.id)).toEqual([
      "color",
      "work",
      "mark",
    ]);
    const presets = folderIconGroups.flatMap((group) => group.presets);
    expect(presets).toHaveLength(18);
    expect(new Set(presets.map((preset) => preset.id)).size).toBe(18);
    for (const preset of presets)
      expect(folderPresetSource(preset)).toContain("data:image/svg+xml");
  });

  it("reads group switches and ignores malformed or unknown values", () => {
    expect(parseFolderIconGroups(null)).toEqual(defaultFolderIconGroups());
    expect(parseFolderIconGroups("not-json")).toEqual(
      defaultFolderIconGroups(),
    );
    expect(
      parseFolderIconGroups(
        JSON.stringify({ color: false, work: "false", unknown: false }),
      ),
    ).toEqual({ color: false, work: true, mark: true });
  });
});

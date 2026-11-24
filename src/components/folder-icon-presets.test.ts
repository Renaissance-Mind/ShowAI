import { describe, expect, it } from "vitest";
import {
  folderIconGroups,
  folderPresetFromIcon,
  tagFolderPresetIcon,
} from "./folder-icon-presets";
import { validatePageIcon } from "../lib/page-icon.mjs";

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
  });

  it("preserves the PNG and identifies its folder preset", () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const preset = folderIconGroups[1].presets[0];
    const tagged = tagFolderPresetIcon(png, preset);
    const bytes = Buffer.from(tagged.split(",")[1], "base64");
    const endOfHeader = 33;
    const endOfTag = endOfHeader + bytes.readUInt32BE(endOfHeader) + 12;
    expect(bytes.subarray(endOfHeader + 4, endOfHeader + 8).toString()).toBe(
      "tEXt",
    );
    expect(
      Buffer.concat([bytes.subarray(0, endOfHeader), bytes.subarray(endOfTag)]),
    ).toEqual(Buffer.from(png.split(",")[1], "base64"));
    expect(validatePageIcon(tagged)).toBe(tagged);
    expect(folderPresetFromIcon(tagged)).toBe(preset);
    expect(folderPresetFromIcon(png)).toBeUndefined();
  });
});

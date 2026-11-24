import { describe, expect, it } from "vitest";
import {
  defaultFolderIconGroups,
  folderIconGroups,
  folderPresetFromIcon,
  folderPresetSource,
  parseFolderIconGroups,
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

  it("retains the closed PNG and identifies the corresponding open preset", () => {
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
    expect(folderPresetSource(preset, true)).not.toBe(
      folderPresetSource(preset),
    );
  });
});

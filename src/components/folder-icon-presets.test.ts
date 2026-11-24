import { describe, expect, it } from "vitest";
import {
  folderColors,
  folderSymbols,
  readFolderIconStyle,
  tagFolderIcon,
} from "./folder-icon-presets";
import { validatePageIcon } from "../lib/page-icon.mjs";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("folder icon styles", () => {
  it("offers unique colors and symbols independently", () => {
    expect(folderColors[0].value).toBe("");
    expect(new Set(folderColors.map(({ value }) => value)).size).toBe(
      folderColors.length,
    );
    expect(new Set(folderSymbols).size).toBe(folderSymbols.length);
  });

  it.each([
    {
      mode: "folder",
      color: "#5b8def",
      badge: { kind: "emoji", value: "👩🏽‍💻" },
      badgeBackground: "adaptive",
    },
    {
      mode: "folder",
      color: "#6f4ccb",
      badge: { kind: "symbol", value: "chart" },
      badgeBackground: "white",
    },
    { mode: "folder", color: "#d47f50", badge: null },
    {
      mode: "standalone",
      color: "#4fae9c",
      badge: { kind: "symbol", value: "chart" },
    },
  ] as const)("round trips %j while keeping the PNG compatible", (style) => {
    const tagged = tagFolderIcon(png, style);
    expect(readFolderIconStyle(tagged)).toEqual(style);
    expect(validatePageIcon(tagged)).toBe(tagged);
    const bytes = Buffer.from(tagged.split(",")[1], "base64");
    const endOfHeader = 33;
    const endOfTag = endOfHeader + bytes.readUInt32BE(endOfHeader) + 12;
    expect(bytes.subarray(endOfHeader + 4, endOfHeader + 8).toString()).toBe(
      "tEXt",
    );
    expect(
      Buffer.concat([bytes.subarray(0, endOfHeader), bytes.subarray(endOfTag)]),
    ).toEqual(Buffer.from(png.split(",")[1], "base64"));
  });

  it("restores the previous preset from a tagged PNG", () => {
    const legacy =
      png.slice(0, 66) +
      "AAAAIXRFWHRTaG93QUkgRm9sZGVyIFByZXNldAB3b3JrLWNoYXJ0ICCl75ti" +
      png.slice(66);
    expect(readFolderIconStyle(legacy)).toEqual({
      mode: "folder",
      color: "#4f9a83",
      badge: { kind: "symbol", value: "chart" },
    });
  });

  it("leaves ordinary images and emoji as direct icons", () => {
    expect(readFolderIconStyle(png)).toBeUndefined();
    expect(readFolderIconStyle("📊")).toBeUndefined();
  });
});

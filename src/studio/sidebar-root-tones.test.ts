import { expect, it } from "vitest";
import { assignSidebarRootTones } from "./sidebar-root-tones";
import {
  paletteColors,
  parseSidebarPalette,
  sidebarRootProps,
} from "../design/sidebar-palette";

it("uses every tone before repeating and separates neighboring roots", () => {
  const ids = Array.from({ length: 24 }, (_, index) => `project:${index}`);
  const tones = assignSidebarRootTones(ids, {});
  for (let start = 0; start < ids.length; start += 6) {
    expect(
      new Set(ids.slice(start, start + 6).map((id) => tones[id])).size,
    ).toBe(6);
  }
  ids
    .slice(1)
    .forEach((id, index) => expect(tones[id]).not.toBe(tones[ids[index]]));
});

it("restores the original appearance and keeps a chosen solid color across palettes", () => {
  expect(parseSidebarPalette("unknown:oops").scheme).toBe("morandi");
  expect(
    sidebarRootProps(parseSidebarPalette("original:#999999"), "sage"),
  ).toEqual({});
  const solid = parseSidebarPalette("solid:#31788d");
  expect(new Set(paletteColors(solid))).toEqual(new Set(["#31788d"]));
  expect(sidebarRootProps(solid, "rose").style).toEqual(
    sidebarRootProps(solid, "sage").style,
  );
  expect(paletteColors({ ...solid, scheme: "coast" })).not.toEqual(
    paletteColors(solid),
  );
});

it("keeps existing colors on reorder and picks an unused tone for a new group", () => {
  const saved = {
    "project:a": "sage",
    "project:b": "rose",
    "project:archived": "teal",
  };
  expect(assignSidebarRootTones(["project:b", "project:a"], saved)).toBe(saved);
  const next = assignSidebarRootTones(
    ["project:b", "group:a", "project:a"],
    saved,
  );
  expect(next).toMatchObject(saved);
  expect(["blue", "oat", "teal", "mauve"]).toContain(next["group:a"]);
  expect(saved).not.toHaveProperty("group:a");
});

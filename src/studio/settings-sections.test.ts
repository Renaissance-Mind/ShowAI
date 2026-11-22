import { expect, it } from "vitest";
import { availableSettingsSection } from "./Settings";

it.each([
  [{ platform: "darwin", libraryVersion: 2 }, "storage"],
  [{ platform: "win32", libraryVersion: 1 }, "general"],
  [{ platform: "ios", libraryVersion: 2 }, "sync"],
  [null, "general"],
] as const)("routes storage and shortcuts for %j", (info, storage) => {
  expect(availableSettingsSection("storage", info)).toBe(storage);
  expect(availableSettingsSection("shortcuts", info)).toBe("shortcuts");
});

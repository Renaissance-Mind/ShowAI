import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getLocale, setLocale } from "../i18n";
import {
  appLanguagePath,
  appLocale,
  followAppLanguage,
  recordAppLanguage,
} from "./app-language";

const libraries: string[] = [];
const runtime = getLocale();
afterEach(async () => {
  vi.unstubAllEnvs();
  setLocale(runtime);
  await Promise.all(
    libraries.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

test("Agent output uses the App's recorded language unless SHOWAI_LANGUAGE pins one", async () => {
  const library = await mkdtemp(join(tmpdir(), "showai-app-language-"));
  libraries.push(library);
  vi.stubEnv("SHOWAI_LANGUAGE", "");
  // An Agent started from an English shell, before the App recorded anything.
  setLocale("en");
  expect(await appLocale(library)).toBe("en");
  await recordAppLanguage(library, "zh-CN");
  expect(await appLocale(library)).toBe("zh-CN");
  await followAppLanguage(library);
  expect(getLocale()).toBe("zh-CN");
  vi.stubEnv("SHOWAI_LANGUAGE", "en-US");
  expect(await appLocale(library)).toBe("en");
  await followAppLanguage(library);
  expect(getLocale()).toBe("en");
  const recorded = await readFile(appLanguagePath(library), "utf8");
  await recordAppLanguage(library, "zh-CN");
  expect(await readFile(appLanguagePath(library), "utf8")).toBe(recorded);
});

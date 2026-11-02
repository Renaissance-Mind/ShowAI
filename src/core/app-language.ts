import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { atomicRename } from "./atomic-rename";
import { getLocale, languageOverride, setLocale, type Locale } from "../i18n";

/**
 * The language the App last showed this library in. Agent runtimes start from
 * the Agent's shell, so they use this record to show the interface the person
 * sees in the App.
 */
export interface AppLanguageRecord {
  format: "showai-app-language";
  version: 1;
  locale: Locale;
  recordedAt: string;
}

export const appLanguagePath = (root: string) =>
  join(root, "local", "app-language.json");

export async function readAppLanguage(
  root: string,
): Promise<Locale | undefined> {
  const text = await readFile(appLanguagePath(root), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (text === null) return undefined;
  const value = JSON.parse(text) as AppLanguageRecord;
  if (
    value.format !== "showai-app-language" ||
    value.version !== 1 ||
    (value.locale !== "zh-CN" && value.locale !== "en")
  )
    throw new Error(`Invalid App language record: ${appLanguagePath(root)}`);
  return value.locale;
}

export async function recordAppLanguage(root: string, locale: Locale) {
  if ((await readAppLanguage(root)) === locale) return;
  const path = appLanguagePath(root);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const value: AppLanguageRecord = {
    format: "showai-app-language",
    version: 1,
    locale,
    recordedAt: new Date().toISOString(),
  };
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
  await atomicRename(temporary, path);
}

/** SHOWAI_LANGUAGE pins tests and headless runs; otherwise the App's record decides. */
export async function appLocale(root: string): Promise<Locale> {
  return languageOverride() ?? (await readAppLanguage(root)) ?? getLocale();
}

/**
 * A standalone runtime's messages and generated pages follow the App's
 * language. The App process owns its language and never calls this.
 */
export async function followAppLanguage(root: string) {
  setLocale(await appLocale(root));
}

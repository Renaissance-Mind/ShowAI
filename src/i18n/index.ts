export const LOCALES = ["zh-CN", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export type LanguagePreference = "system" | Locale;

export const LOCALE_NAMES: Record<Locale, string> = {
  "zh-CN": "简体中文",
  en: "English",
};

export const LANGUAGE_STORAGE_KEY = "showai:language";

export type Message =
  | string
  | { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string };

export type MessageParams = Record<string, string | number>;

export type Translation<T> = { [K in keyof T]: Message };

export interface Namespace<T extends Record<string, Message>> {
  readonly name: string;
  readonly catalogs: { readonly "zh-CN": T; readonly en: Translation<T> };
}

export function defineMessages<T extends Record<string, Message>>(
  name: string,
  catalogs: { "zh-CN": T; en: Translation<T> },
): Namespace<T> {
  return { name, catalogs };
}

export type MessageKey<N> = N extends Namespace<infer T> ? keyof T & string : never;

export type Translator<T> = (key: keyof T & string, params?: MessageParams) => string;

export function resolveLocale(
  tags: string | readonly (string | undefined | null)[] | undefined | null,
): Locale {
  const list = typeof tags === "string" ? [tags] : (tags ?? []);
  const first = list.find((tag): tag is string => !!tag && tag.trim() !== "");
  return first && /^zh\b/i.test(first.trim()) ? "zh-CN" : "en";
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "system" || value === "zh-CN" || value === "en";
}

function environment(): Record<string, string | undefined> {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

export function languageOverride(): Locale | undefined {
  const value = environment().SHOWAI_LANGUAGE;
  return value ? resolveLocale(value) : undefined;
}

function systemLanguages(): readonly string[] {
  const override = environment().SHOWAI_LANGUAGE;
  if (override) return [override];
  if (typeof navigator !== "undefined") {
    if (navigator.languages?.length) return navigator.languages;
    if (navigator.language) return [navigator.language];
  }
  const env = environment();
  const posix = env.LC_ALL || env.LC_MESSAGES || env.LANG;
  if (posix && posix !== "C" && posix !== "POSIX")
    return [posix.split(/[.@]/)[0].replace("_", "-")];
  return [Intl.DateTimeFormat().resolvedOptions().locale];
}

function hostLocale(): Locale | undefined {
  if (typeof document === "undefined") return undefined;
  const value = document.documentElement?.dataset.showaiLocale;
  return value === "zh-CN" || value === "en" ? value : undefined;
}

let systemLocale: Locale = resolveLocale(systemLanguages());
let preference: LanguagePreference = "system";
let current: Locale = hostLocale() ?? systemLocale;
const listeners = new Set<() => void>();

function readStoredPreference(): LanguagePreference {
  try {
    const saved = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguagePreference(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function apply(next: Locale, notify = false) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
    document.documentElement.dataset.showaiLocale = next;
  }
  if (next === current && !notify) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

export function getLocale(): Locale {
  return current;
}

export function getLanguagePreference(): LanguagePreference {
  return preference;
}

export function initLanguagePreference(): Locale {
  preference = readStoredPreference();
  apply(preference === "system" ? systemLocale : preference);
  return current;
}

export function setLanguagePreference(next: LanguagePreference) {
  preference = next;
  try {
    if (next === "system") globalThis.localStorage?.removeItem(LANGUAGE_STORAGE_KEY);
    else globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, next);
  } catch {
  }
  apply(next === "system" ? systemLocale : next, true);
}

export function setLocale(next: Locale, system?: Locale) {
  if (system) systemLocale = system;
  apply(next);
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

export function formatMessage(
  message: Message,
  params: MessageParams | undefined,
  locale: Locale = current,
): string {
  let text: string;
  if (typeof message === "string") text = message;
  else {
    const count = Number(params?.count ?? 0);
    let rules = pluralRules.get(locale);
    if (!rules) pluralRules.set(locale, (rules = new Intl.PluralRules(locale)));
    const category = count === 0 && message.zero !== undefined ? "zero" : rules.select(count);
    text = message[category] ?? message.other;
  }
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

export function translator<T extends Record<string, Message>>(
  namespace: Namespace<T>,
): Translator<T> {
  return (key, params) => {
    const catalog = namespace.catalogs[current] as Record<string, Message>;
    const message = catalog[key] ?? (namespace.catalogs["zh-CN"] as Record<string, Message>)[key];
    if (message === undefined) return `${namespace.name}.${key}`;
    return formatMessage(message, params);
  };
}

export function withHtmlLanguage(html: string, locale: Locale = current): string {
  return html.replace(/<html\b[^>]*>/i, (tag) =>
    /\slang=/i.test(tag)
      ? tag.replace(/\slang=(["'])[^"']*\1/i, ` lang="${locale}"`)
      : tag.replace(/^<html/i, `<html lang="${locale}"`),
  );
}

export function byLocale<T>(values: Record<Locale, T>): T {
  return values[current];
}

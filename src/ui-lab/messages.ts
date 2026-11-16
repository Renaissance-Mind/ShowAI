import type { Locale, Message, Namespace } from "../i18n";

export function messages<N extends Record<string, Message>>(
  namespace: Namespace<N>,
  locale: Locale,
) {
  return (
    key: keyof N & string,
    params: Record<string, string | number> = {},
  ) => {
    const value = namespace.catalogs[locale][key];
    if (typeof value !== "string")
      throw new Error("UI scene labels must be strings.");
    return value.replace(/\{(\w+)\}/g, (_match, key) =>
      String(params[key] ?? `{${key}}`),
    );
  };
}

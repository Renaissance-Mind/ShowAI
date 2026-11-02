import { readAppLanguage } from "../core/app-language";
import { getLocale, languageOverride, type Locale } from "../i18n";

/** Insert transient reading state before the reader module, never into markup literals inside its JavaScript. */
export function injectReadingOptions(html: string, options: unknown): string {
  const head = /<head\b[^>]*>/i;
  if (!head.test(html))
    throw new Error("The reader HTML has no document head.");
  const payload = JSON.stringify(options).replaceAll("<", "\\u003c");
  return html.replace(
    head,
    (open) =>
      `${open}<script id="showai-read-options" type="application/json">${payload}</script>`,
  );
}

/**
 * Rendered reads show controls in the language the App shows this library in,
 * whatever locale the Agent's environment gives the runtime. SHOWAI_LANGUAGE
 * still pins tests and headless runs.
 */
export async function readingLocale(root: string): Promise<Locale> {
  return languageOverride() ?? (await readAppLanguage(root)) ?? getLocale();
}

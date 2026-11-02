import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appLanguagePath, recordAppLanguage } from "../core/app-language";
import { getLocale, setLocale } from "../i18n";
import { injectReadingOptions, readingLocale } from "./reading-preview";

const libraries: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    libraries.splice(0).map((path) => rm(path, { recursive: true })),
  );
});
test("reading options do not corrupt bundled HTML literals or permit script termination", () => {
  const script =
    '<script type="module">const fragment="</head>";const template="<head>inner</head>";</script>';
  const html = `<html><head><title>Reader</title>${script}</head><body></body></html>`;
  const output = injectReadingOptions(html, {
    label: "</script><script>unsafe()</script>",
    theme: "dark",
  });
  expect(output).toContain(script);
  expect(
    output.startsWith('<html><head><script id="showai-read-options"'),
  ).toBe(true);
  const payload = output.match(
    /id="showai-read-options" type="application\/json">(.*?)<\/script>/,
  )![1];
  expect(payload).not.toContain("<");
  expect(JSON.parse(payload).label).toBe("</script><script>unsafe()</script>");
  expect(() => injectReadingOptions("<body></body>", {})).toThrow(
    "no document head",
  );
});

test("rendered reads use the App's recorded language unless SHOWAI_LANGUAGE pins one", async () => {
  const library = await mkdtemp(join(tmpdir(), "showai-reading-language-"));
  libraries.push(library);
  const runtime = getLocale();
  vi.stubEnv("SHOWAI_LANGUAGE", "");
  // An Agent started from an English shell, before the App recorded anything.
  setLocale("en");
  try {
    expect(await readingLocale(library)).toBe("en");
    await recordAppLanguage(library, "zh-CN");
    expect(await readingLocale(library)).toBe("zh-CN");
    vi.stubEnv("SHOWAI_LANGUAGE", "en-US");
    expect(await readingLocale(library)).toBe("en");
  } finally {
    setLocale(runtime);
  }
  const recorded = await readFile(appLanguagePath(library), "utf8");
  await recordAppLanguage(library, "zh-CN");
  expect(await readFile(appLanguagePath(library), "utf8")).toBe(recorded);
});

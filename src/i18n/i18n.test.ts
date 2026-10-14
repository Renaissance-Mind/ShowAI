import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { parseSync } from "rolldown/utils";
import { describe, expect, it } from "vitest";
import { builtinSources } from "../core/builtin-sources";
import {
  formatMessage,
  resolveLocale,
  setLocale,
  translator,
  withHtmlLanguage,
  type Message,
  type Namespace,
} from "./index";

const root = join(import.meta.dirname, "../..");
const namespaces = import.meta.glob<{ default: Namespace<Record<string, Message>> }>(
  "./messages/*.ts",
  { eager: true },
);
const han = /\p{Script=Han}/u;

function texts(message: Message): string[] {
  return typeof message === "string" ? [message] : Object.values(message).filter(Boolean) as string[];
}
function placeholders(message: Message): string[] {
  return [...new Set(texts(message).flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();
}

describe("message catalogs", () => {
  it("are registered", () => {
    expect(Object.keys(namespaces).length).toBeGreaterThan(0);
  });

  for (const [file, { default: namespace }] of Object.entries(namespaces)) {
    describe(file, () => {
      const zh = namespace.catalogs["zh-CN"];
      const en = namespace.catalogs.en as Record<string, Message>;

      it("is named after its file", () => {
        expect(file).toBe(`./messages/${namespace.name}.ts`);
      });

      it("has identical keys in zh-CN and en", () => {
        expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
      });

      it("uses the same placeholders in both languages", () => {
        for (const key of Object.keys(zh))
          expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]));
      });

      it("has non-empty English text without Chinese characters", () => {
        for (const [key, message] of Object.entries(en))
          for (const text of texts(message)) {
            expect(text.trim(), key).not.toBe("");
            expect(han.test(text), `${key}: ${text}`).toBe(false);
          }
      });
    });
  }
});

describe("i18n runtime", () => {
  it("maps Chinese locales to zh-CN and everything else to English", () => {
    expect(resolveLocale("zh")).toBe("zh-CN");
    expect(resolveLocale(["zh-TW", "en"])).toBe("zh-CN");
    expect(resolveLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(resolveLocale(["en-GB", "zh-CN"])).toBe("en");
    expect(resolveLocale("fr")).toBe("en");
    expect(resolveLocale([])).toBe("en");
  });

  it("interpolates params and selects plural forms", () => {
    expect(formatMessage("{name} · {name}", { name: "A" }, "en")).toBe("A · A");
    expect(formatMessage("{missing}", {}, "en")).toBe("{missing}");
    const pages = { one: "{count} page", other: "{count} pages" };
    expect(formatMessage(pages, { count: 1 }, "en")).toBe("1 page");
    expect(formatMessage(pages, { count: 3 }, "en")).toBe("3 pages");
  });

  it("records the exporter language on reader HTML", () => {
    expect(withHtmlLanguage('<!doctype html><html lang="zh-CN"><head>', "en")).toBe(
      '<!doctype html><html lang="en"><head>',
    );
    expect(withHtmlLanguage("<html><body>", "zh-CN")).toBe('<html lang="zh-CN"><body>');
  });

  it("translates with the active locale", () => {
    const t = translator(namespaces["./messages/common.ts"].default);
    setLocale("en");
    expect(t("cancel")).toBe("Cancel");
    setLocale("zh-CN");
    expect(t("cancel")).toBe("取消");
  });
});

describe("built-in component package", () => {
  it("contains every i18n module its sources import", () => {
    const missing: string[] = [];
    for (const [name, source] of Object.entries(builtinSources))
      for (const [, specifier] of source.matchAll(/from\s+["']([^"']*i18n[^"']*)["']/g)) {
        if (!specifier.startsWith(".") || /archify-i18n/.test(specifier)) continue;
        const target = posix.normalize(posix.join(posix.dirname(name), specifier));
        if (![`${target}.ts`, `${target}/index.ts`].some((file) => file in builtinSources))
          missing.push(`${name} → ${specifier}`);
      }
    expect(missing).toEqual([]);
  });
});

// Workbench UI sources whose user-visible strings live in the catalogs.
const scanned = [
  "src/App.tsx",
  "src/CanvasApp.tsx",
  "src/studio",
  "src/editor",
  "src/surface",
  "src/workbench",
  "src/ui",
  "src/components",
  "src/browser",
  "src/desktop",
  "src/portable",
];

// Whole files that may keep Chinese text, with the reason. Prefer a line
// marker (`// i18n-exempt: reason` on the line or the line above) for single
// strings such as saved defaults or agent-facing protocol text.
const exemptFiles: Record<string, string> = {
  "src/portable/cdn-fragment.mjs":
    "standalone reader bootstrap selects bilingual text from the page language before i18n is loaded",
  "src/components/blocks/diagrams/archify-i18n.mjs":
    "Archify's own bilingual diagram catalog",
  "src/components/blocks/registry.ts":
    "built-in catalog titles, saved defaults and validation shared with the CLI/MCP",
  "src/components/blocks/g2/catalog.js":
    "G2 catalog metadata written into resources/catalog/g2.json",
  "src/components/blocks/research-contract.mjs":
    "data validation messages shared with the CLI/MCP",
  "src/components/blocks/primitive-contract.mjs":
    "data validation messages shared with the CLI/MCP",
  "src/components/rich-text/model.mjs":
    "rich-text validation shared with the CLI/MCP and the saved default node name",
};

function sourceFiles(path: string): string[] {
  const absolute = join(root, path);
  if (statSync(absolute).isFile()) return [path];
  return readdirSync(absolute).flatMap((name) => {
    const child = `${path}/${name}`;
    if (statSync(join(root, child)).isDirectory()) return sourceFiles(child);
    return /\.(?:[cm]?[jt]sx?)$/.test(name) &&
      !/\.test\.|\.d\.m?ts$|smoke|fixture/.test(name)
      ? [child]
      : [];
  });
}

/** Lines that still contain Chinese outside comments and without an exemption marker. */
function hardCodedLines(path: string): string[] {
  const source = readFileSync(join(root, path), "utf8");
  const lang = /\.tsx$/.test(path) ? "tsx" : /\.[cm]?ts$/.test(path) ? "ts" : "jsx";
  const parsed = parseSync(path, source, { lang });
  let code = source;
  for (const comment of parsed.comments)
    code =
      code.slice(0, comment.start) +
      code.slice(comment.start, comment.end).replace(/[^\n]/g, " ") +
      code.slice(comment.end);
  const original = source.split("\n");
  return code.split("\n").flatMap((line, index) =>
    han.test(line) &&
    !/i18n-exempt/.test(original[index]) &&
    !/i18n-exempt/.test(original[index - 1] ?? "")
      ? [`${path}:${index + 1}: ${line.trim()}`]
      : [],
  );
}

describe("migrated UI sources", () => {
  const files = scanned.flatMap(sourceFiles);

  it("contain no hard-coded Chinese strings", () => {
    const found = files
      .filter((file) => !(file in exemptFiles))
      .flatMap(hardCodedLines);
    expect(found).toEqual([]);
  });

  it("only exempt files that still need it", () => {
    for (const file of Object.keys(exemptFiles))
      expect(hardCodedLines(file).length, relative(root, join(root, file))).toBeGreaterThan(0);
  });
});

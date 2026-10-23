import { describe, expect, it } from "vitest";
import { englishInChinese, glossaryRules } from "./glossary";
import type { Message, Namespace } from "./index";

const namespaces = Object.values(
  import.meta.glob<{ default: Namespace<Record<string, Message>> }>(
    "./messages/*.ts",
    { eager: true },
  ),
).map((module) => module.default);

function values(locale: "zh-CN" | "en") {
  return namespaces.flatMap((namespace) =>
    Object.entries(namespace.catalogs[locale] as Record<string, Message>).flatMap(
      ([key, message]) =>
        (typeof message === "string"
          ? [message]
          : (Object.values(message).filter(Boolean) as string[])
        ).map((text) => ({ id: `${namespace.name}.${key}`, text })),
    ),
  );
}

describe("terminology glossary", () => {
  for (const rule of glossaryRules)
    it(`${rule.locale}: ${rule.rule}`, () => {
      const exempt = Object.keys(rule.exemptKeys ?? {});
      const found = values(rule.locale)
        .filter(({ id }) => !exempt.some((prefix) => id.startsWith(prefix)))
        .filter(({ text }) => rule.pattern.test(text))
        .map(({ id, text }) => `${id}: ${text}`);
      expect(found).toEqual([]);
    });

  it("only exempts keys that still need it", () => {
    for (const rule of glossaryRules)
      for (const prefix of Object.keys(rule.exemptKeys ?? {}))
        expect(
          values(rule.locale).some(
            ({ id, text }) => id.startsWith(prefix) && rule.pattern.test(text),
          ),
          `${rule.rule}: ${prefix}`,
        ).toBe(true);
  });
});

/**
 * English words left in Chinese text after removing placeholders, paths,
 * URLs, code-like identifiers and the allowed product names. Two or more
 * words in a row read as an untranslated phrase; a single word is a name
 * such as Codex, MCP or JSON.
 */
function untranslatedPhrases(text: string) {
  // Removed parts become "|" so they also end a run of words.
  let rest = text
    .replace(/\{\w+\}/g, "|")
    .replace(/`[^`]*`/g, "|")
    .replace(/\S*\w[./_:@=\\+]\w\S*/g, "|")
    .replace(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g, "|")
    .replace(/\b[a-z]+[A-Z]\w*\b/g, "|")
    .replace(/\b(?:Ctrl|Shift|Alt|Home|End|Tab|Esc|Enter|Delete|Space)\b/g, "|");
  for (const name of englishInChinese) rest = rest.split(name).join("|");
  return rest.match(/[A-Za-z][A-Za-z'’]*(?:[ -]+[A-Za-z][A-Za-z'’]*)+/g) ?? [];
}

describe("zh-CN catalogs", () => {
  it("have no untranslated English phrases", () => {
    const found = values("zh-CN")
      .filter(({ text }) => untranslatedPhrases(text).length)
      .map(({ id, text }) => `${id}: ${text}`);
    expect(found).toEqual([]);
  });

  it("detect untranslated phrases", () => {
    expect(untranslatedPhrases("Not installed")).toEqual(["Not installed"]);
    expect(
      untranslatedPhrases("不可用 · Outline component did not become ready."),
    ).toEqual(["Outline component did not become ready"]);
    expect(untranslatedPhrases("用 Claude Code 或 Codex 连接 MCP")).toEqual([]);
    expect(untranslatedPhrases("{shown} / {total}")).toEqual([]);
  });

  it("allow only product names that still appear", () => {
    const text = values("zh-CN").map(({ text }) => text);
    for (const name of englishInChinese)
      expect(text.some((value) => value.includes(name)), name).toBe(true);
  });
});

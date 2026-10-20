import { describe, expect, it } from "vitest";
import { builtinComponent } from "../components/catalog";
import {
  findComponent,
  indexComponents,
} from "../components/custom/component-index";
import { LOCALES } from "../i18n";
import {
  builtinDocLink,
  builtinDocPath,
  builtinDocs,
  DOCS_HOME,
  loadBuiltinDoc,
  type DocsEntry,
} from "./builtin-docs";
import manifest from "../../resources/docs/manifest.json";

const pageIds = (entries: DocsEntry[]): string[] =>
  entries.flatMap((entry) =>
    entry.type === "page" ? [entry.id] : pageIds(entry.children),
  );
const shape = (entries: DocsEntry[]): unknown =>
  entries.map((entry) =>
    entry.type === "page" ? entry.id : { [entry.id]: shape(entry.children) },
  );

describe("built-in documentation", () => {
  it("lists every documentation page of the website once, in the same tree for each language", () => {
    const slugPages = Object.values(manifest.slugs).sort();
    for (const locale of LOCALES) {
      const ids = pageIds(builtinDocs(locale).tree);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual(slugPages);
      expect(Object.keys(builtinDocs(locale).pages).sort()).toEqual(slugPages);
    }
    expect(shape(builtinDocs("en").tree)).toEqual(
      shape(builtinDocs("zh-CN").tree),
    );
    expect(builtinDocPath("zh-CN", DOCS_HOME)).toEqual([]);
  });

  it("keeps links to the website's documentation inside the App", () => {
    const cli = manifest.slugs.cli;
    expect(
      builtinDocLink("https://showai.renaissancemind.ai/doc/cli#mcp"),
    ).toEqual({ pageId: cli, hash: "#mcp" });
    expect(
      builtinDocLink("https://showai.renaissancemind.ai/en/doc/cli"),
    ).toEqual({ pageId: cli, hash: "" });
    expect(builtinDocLink("https://showai.renaissancemind.ai/doc")).toEqual({
      pageId: DOCS_HOME,
      hash: "",
    });
    expect(
      builtinDocLink("https://showai.renaissancemind.ai/doc/unknown"),
    ).toBeUndefined();
    expect(
      builtinDocLink("https://showai.renaissancemind.ai/cloud"),
    ).toBeUndefined();
    expect(builtinDocLink("https://example.com/doc/cli")).toBeUndefined();
    expect(builtinDocLink("doc/cli")).toBeUndefined();
  });

  it("renders every page with App components and the components shipped beside it", async () => {
    for (const locale of LOCALES) {
      for (const id of Object.keys(builtinDocs(locale).pages)) {
        const { document, components } = await loadBuiltinDoc(locale, id);
        expect(document.id).toBe(id);
        const index = indexComponents(components);
        const problems: string[] = [];
        const visit = (node: unknown) => {
          if (Array.isArray(node)) return node.forEach(visit);
          if (!node || typeof node !== "object") return;
          const { type, attrs } = node as {
            type?: string;
            attrs?: Record<string, any>;
          };
          if (type === "widget" && attrs?.kind) {
            if (attrs.kind === "custom") {
              if (!findComponent(index, attrs.data))
                problems.push(
                  `${attrs.data?.componentId}@${attrs.data?.version}`,
                );
            } else if (!builtinComponent(attrs.kind)) problems.push(attrs.kind);
          }
          Object.values(node).forEach(visit);
        };
        visit(document.content);
        expect(problems, `${locale} ${document.title}`).toEqual([]);
      }
    }
  });
});

import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

export const codeLanguages = lowlight.listLanguages();

export function normalizeCodeLanguage(language?: string | null): string {
  return language?.trim().toLowerCase().split(/\s+/)[0] || "plaintext";
}

export function supportsCodeLanguage(language?: string | null): boolean {
  return lowlight.registered(normalizeCodeLanguage(language));
}

type Tokens = ReturnType<typeof lowlight.highlight>["children"];

function flattenTokens(nodes: Tokens, classes: string[] = []): Tokens {
  return nodes.flatMap((node): Tokens => {
    if (node.type === "text") {
      return classes.length
        ? [
            {
              type: "element",
              tagName: "span",
              properties: { className: classes },
              children: [node],
            },
          ]
        : [node];
    }
    if (node.type !== "element") return [];
    const own = node.properties.className;
    return flattenTokens(
      node.children,
      Array.isArray(own) && own.length ? own.map(String) : classes,
    );
  });
}

export function highlightCode(code: string, language?: string | null) {
  const name = normalizeCodeLanguage(language);
  const tree = lowlight.highlight(
    lowlight.registered(name) ? name : "plaintext",
    code,
  );
  return { ...tree, children: flattenTokens(tree.children) };
}

export const codeHighlighter = {
  listLanguages: () => codeLanguages,
  registered: supportsCodeLanguage,
  highlight: (language: string, code: string) => highlightCode(code, language),
  highlightAuto: (code: string) => highlightCode(code),
};

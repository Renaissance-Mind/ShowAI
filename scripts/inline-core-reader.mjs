import { parseSync } from "vite";

/** The document reader does not need optional native G2 registrations.
 * Custom components carry their own compiled dependencies.
 */
export function inlineCoreReaderPlugin() {
  return {
    name: "showai-inline-core-reader",
    enforce: "pre",
    transform(source, id) {
      if (
        !id.replaceAll("\\", "/").endsWith("/src/components/blocks/registry.ts")
      )
        return;
      const parsed = parseSync(id, source);
      if (parsed.errors.length)
        throw new Error(
          `Cannot build inline reader: ${parsed.errors[0].message}`,
        );
      const ranges = [];
      const omitted = new Set();
      for (const statement of parsed.program.body) {
        if (statement.type === "ImportDeclaration") {
          const path = statement.source.value;
          if (path.endsWith("/G2Chart") || path.endsWith("/catalog/g2.json")) {
            for (const specifier of statement.specifiers)
              omitted.add(specifier.local.name);
            ranges.push([statement.start, statement.end]);
          }
        }
      }
      for (const statement of parsed.program.body)
        if (
          statement.type === "ForOfStatement" &&
          statement.right.type === "Identifier" &&
          omitted.has(statement.right.name)
        )
          ranges.push([statement.start, statement.end]);
      let code = source;
      for (const [start, end] of ranges.sort((a, b) => b[0] - a[0]))
        code = code.slice(0, start) + code.slice(end);
      return { code, map: null };
    },
  };
}

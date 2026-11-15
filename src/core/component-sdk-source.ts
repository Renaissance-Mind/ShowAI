/** Keep named SDK imports from pulling unrelated components' CSS into exports.
 * Unknown import forms retain the complete SDK, preserving its existing API.
 */
export function componentSdkSource(sdk: string, modules: readonly string[]) {
  const requested = new Set<string>();
  const named =
    /\b(?:import|export)\s*(?:type\s*)?\{([^}]*)\}\s*from\s*(["'])showai:components\2\s*;?/g;
  for (const source of modules) {
    const remaining = source.replace(named, (_all, list: string) => {
      for (const entry of list.split(",")) {
        const name = entry
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0];
        if (name) requested.add(name);
      }
      return "";
    });
    if (remaining.includes("showai:components")) return sdk;
  }
  const exports =
    /\bexport\s*(?:type\s*)?\{([^}]*)\}\s*from\s*(["'])([^"']+)\2\s*;?/g;
  const available = new Set<string>();
  const exportedName = (entry: string) =>
    entry
      .trim()
      .replace(/^type\s+/, "")
      .split(/\s+as\s+/)
      .at(-1)!;
  for (const match of sdk.matchAll(exports)) {
    for (const entry of match[1].split(",")) available.add(exportedName(entry));
  }
  // Wildcard exports (for example G2) remain available without guessing names.
  if ([...requested].some((name) => !available.has(name))) return sdk;
  return sdk
    .replace(exports, (all, list: string) => {
      const kept = list
        .split(",")
        .filter((entry) => requested.has(exportedName(entry)));
      return kept.length ? all.replace(list, kept.join(",")) : "";
    })
    .replace(/\bexport\s*\*\s*from\s*(["'])[^"']+\1\s*;?/g, "");
}

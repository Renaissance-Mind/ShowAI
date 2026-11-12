import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const src = resolve(import.meta.dirname, "..");
const documentRoot = join(src, "document");

interface ImportRecord {
  file: string;
  specifier: string;
  typeOnly: boolean;
}

/** npm packages the document layer may use, and whether values may be imported. */
const PACKAGES: Record<string, "value" | "type"> = {
  "@dagrejs/dagre": "value",
  "@tiptap/core": "type",
};

/** Imports that still leave the layer, keyed by importing file and specifier. */
const EXCEPTIONS: Record<string, string> = {
  "document/drawing-geometry.mjs → ../surface/portable-ink.mjs":
    "hit tests and bounds of portable ink strokes need the ink formats, which stay in surface this round",
  "document/page-outline.d.mts → ../components/custom/types":
    "type only: an outline renderer is stored as a custom component reference",
};

/** Modules in src/surface that lower layers still import on purpose. */
const SURFACE_IMPORTS_FROM_LOWER_LAYERS = [
  "surface/ContainerRuntime.tsx",
  "surface/NativeInkPreview.tsx",
  "surface/agent-reference.ts",
  "surface/component-insertion.ts",
  "surface/cubic-ink-core.mjs",
  "surface/cubic-ink.mjs",
  "surface/ink-archive-group.mjs",
  "surface/ink-kernel/compiled-ink-input.mjs",
  "surface/ink-kernel/compiled-ink.mjs",
  "surface/ink-kernel/ink-kernel-wasm.mjs",
  "surface/ink-kernel/ink-stroke-kernel.mjs",
  "surface/ink-operations.mjs",
  "surface/ink-wire.mjs",
  "surface/native-board-scene.mjs",
  "surface/native-ink.css",
  "surface/native-ink.mjs",
  "surface/object-context.ts",
  "surface/portable-cubic-client.mjs",
  "surface/portable-ink-v2.mjs",
  "surface/portable-ink.mjs",
  "surface/reader-state.ts",
  "surface/source-runtime.ts",
  "surface/text-selection-model.ts",
  "surface/text-selection.ts",
  "surface/validation.mjs",
];

const LOWER_LAYERS = ["core", "agent", "agent-host", "sync", "datasets", "portable"];

/** Modules that moved from src/surface to src/document. */
const MOVED = [
  "connections",
  "containers",
  "diagram",
  "document",
  "drawing-completion",
  "drawing-geometry",
  "drawing-label",
  "geometry",
  "lasso",
  "page-annotations",
  "page-outline",
  "types",
];

const sourceFile = /\.(ts|tsx|mjs|mts)$/;
const isTest = (file: string) => /\.test\.ts$|\.fixture\.|\/fixtures\//.test(file);

function files(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return files(path);
    return sourceFile.test(name) && !isTest(path) ? [path] : [];
  });
}

// TypeScript 7 ships no compiler API, so imports are read with patterns that
// cover every form this codebase uses: static, re-export, side effect,
// dynamic and import() type queries.
function imports(file: string): ImportRecord[] {
  const text = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const declaration = file.endsWith(".d.mts") || file.endsWith(".d.ts");
  const found: ImportRecord[] = [];
  const statement =
    /\b(import|export)\s+(type\s+)?([\w*\s{},$]*?)\s*from\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(statement)) {
    const clause = match[3].trim();
    const named = /^\{([\s\S]*)\}$/.exec(clause)?.[1];
    const members = named?.split(",").map((part) => part.trim()).filter(Boolean);
    const typeOnly =
      !!match[2] ||
      (!!members?.length && members.every((part) => part.startsWith("type ")));
    found.push({ file, specifier: match[4], typeOnly });
  }
  for (const match of text.matchAll(/\bimport\s*["']([^"']+)["']/g))
    found.push({ file, specifier: match[1], typeOnly: false });
  for (const match of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g))
    found.push({ file, specifier: match[1], typeOnly: declaration });
  return found;
}

const suffixes = ["", ".ts", ".tsx", ".mjs", ".d.mts", "/index.ts"];
function resolveRelative(file: string, specifier: string) {
  const target = resolve(dirname(file), specifier.split("?")[0]);
  const match = suffixes.find((suffix) => {
    const path = target + suffix;
    return existsSync(path) && statSync(path).isFile();
  });
  return match === undefined ? null : target + match;
}

const name = (path: string) => relative(src, path).split("\\").join("/");

describe("document layer", () => {
  test("imports only itself, src/types.ts and listed npm packages", () => {
    const violations: string[] = [];
    const used = new Set<string>();
    for (const file of files(documentRoot))
      for (const record of imports(file)) {
        const key = `${name(file)} → ${record.specifier}`;
        if (!record.specifier.startsWith(".")) {
          const allowed = PACKAGES[record.specifier];
          if (allowed === "value" || (allowed === "type" && record.typeOnly))
            continue;
        } else {
          const target = resolveRelative(file, record.specifier);
          if (!target) {
            violations.push(`${key} (unresolved)`);
            continue;
          }
          if (
            target.startsWith(documentRoot + "/") ||
            target === join(src, "types.ts")
          )
            continue;
        }
        if (key in EXCEPTIONS) {
          used.add(key);
          continue;
        }
        violations.push(key);
      }
    expect(violations).toEqual([]);
    // An exception nobody needs any more is removed, so the list stays minimal.
    expect([...used].sort()).toEqual(Object.keys(EXCEPTIONS).sort());
  });

  test("lower layers reach the moved modules only through src/document", () => {
    const stale: string[] = [];
    const surface = new Set<string>();
    for (const layer of LOWER_LAYERS)
      for (const file of files(join(src, layer)))
        for (const record of imports(file)) {
          if (!record.specifier.startsWith(".")) continue;
          const bare = record.specifier.split("?")[0];
          const raw = resolve(dirname(file), bare);
          if (
            name(raw).startsWith("surface/") &&
            MOVED.some((module) =>
              new RegExp(`^surface/${module}(\\.[a-z.]+)?$`).test(name(raw)),
            )
          )
            stale.push(`${name(file)} → ${record.specifier}`);
          const target = resolveRelative(file, record.specifier);
          if (target && name(target).startsWith("surface/"))
            surface.add(name(target));
        }
    expect(stale).toEqual([]);
    // Adding a surface import to a lower layer is a deliberate decision:
    // list it here. Removing one shortens the list.
    expect([...surface].sort()).toEqual(
      [...SURFACE_IMPORTS_FROM_LOWER_LAYERS].sort(),
    );
  });
});

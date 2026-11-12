import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// Layers of src, lowest first. A module may import its own layer and the layers
// below it. Imports that still point upward are pinned in RATCHET.
//
// The order is the one the code satisfies today: the page tree model
// (document) is the base and the content library stores it; the component
// contract sits between them because core validates and catalogs components.
// The server implements the sync protocol, so it sits above core and sync.
// components/custom holds the frame runtime (CustomBlock, InlineComponent),
// which renders with block helpers, text selection and local resources, so it
// sits with the presentation; its contract is src/contract. Agent access sits
// below the workbench: the desktop and browser hosts start the Agent services
// and the workbench shows their state.
const LAYERS: readonly (readonly [string, readonly string[]])[] = [
  ["shared", ["types.ts", "lib", "i18n", "ui", "design", "host"]],
  ["document", ["document"]],
  // Built-in block contracts (components/blocks/**/*contract.mjs) and their
  // helpers also belong here; see isBuiltinContract.
  ["contract", ["contract"]],
  ["library", ["core", "sync"]],
  ["server", ["server"]],
  ["runtime", ["datasets", "problems"]],
  [
    "presentation",
    [
      "surface",
      "components/custom",
      "components/rich-text",
      "components/blocks",
      "components",
      "portable",
      "editor",
      "comments",
    ],
  ],
  ["agent", ["agent", "agent-host", "plugin", "remote-mcp"]],
  [
    "workbench",
    [
      "studio",
      "workbench",
      "desktop",
      "browser",
      "App.tsx",
      "AppErrorBoundary.tsx",
      "CanvasApp.tsx",
      "ConnectionBanner.tsx",
      "main.tsx",
      "styles.css",
    ],
  ],
];

/** Pure helpers of built-in contracts, importable wherever the contracts are. */
const BUILTIN_CONTRACT_HELPERS = [
  // Inline markup of the doc-browse and doc-reference contracts.
  "components/blocks/inline-markup.mjs",
  "components/blocks/inline-markup.d.mts",
];

// Pattern matches that are generated source text inside strings, not imports.
const NOT_IMPORTS = [
  // The nested component wrapper compiled for a package's entry file.
  "core/catalog.ts → ./${owner.manifest.entry.replace(/^\\.\\//, ",
  // Stub module source the reader bundle substitutes for widget messages.
  "portable/reader-bundle.mjs → ../../i18n",
  "portable/reader-bundle.mjs → ../../i18n/messages/widget",
];

// Imports that point to a higher layer, keyed by importing directory and
// imported module: [number of import statements, reason]. Adding an import
// fails; removing one fails until its count or entry is lowered, so the list
// only shrinks. Type-only imports count: a type ties a module to the layer
// that owns it as much as a value does.
const CAPACITY = "content byte and depth limits; portable/capacity.mjs is a format rule that stays in portable this round";
const VALIDATION = "page validation; portable/validation.mjs is a format rule that stays in portable this round";
const DATASET_FORMAT = "the library stores and resolves shared data in the formats src/datasets defines";
const DATASET_HOST = "React hosts of data-bound components; datasets renders through them";
const INK_FORMAT = "ink formats stay in surface this round";
const RATCHET: Record<string, readonly [number, string]> = {
  "agent → browser/launch.ts": [1, "the CLI's serve command starts the browser host"],
  "components/blocks → datasets/derived-fields.mjs": [1, "database contract: rollup rules of shared data"],
  "components/blocks → datasets/record-query.mjs": [1, "database contract: filter and sort rules of shared data"],
  "components/blocks → datasets/value-types.mjs": [1, "database contract: value kinds of shared data"],
  "components/blocks → portable/capacity.mjs": [1, `research contract: ${CAPACITY}`],
  "components/blocks → surface/native-ink.mjs": [1, `primitive contract: ${INK_FORMAT}`],
  "contract → datasets/value-types.mjs": [2, "contributions declare operators over shared data value kinds"],
  "contract → portable/capacity.mjs": [2, CAPACITY],
  "contract → portable/template-bundle.mjs": [4, "type only: template metadata names the bundle stage and source types"],
  "core → agent-host/types.ts": [1, "type only: page references carry the Agent target of a message"],
  "core → components/blocks/diagrams/templates.ts": [1, "diagram template sources written into component packages"],
  "core → components/blocks/g2/exports-map.json": [1, "export names of the shipped G2 SDK sources"],
  "core → datasets/binding.mjs": [6, DATASET_FORMAT],
  "core → datasets/dataset-file.ts": [7, DATASET_FORMAT],
  "core → datasets/derived-fields.mjs": [1, DATASET_FORMAT],
  "core → datasets/editable.mjs": [2, DATASET_FORMAT],
  "core → datasets/operations.mjs": [4, DATASET_FORMAT],
  "core → datasets/value-types.mjs": [1, DATASET_FORMAT],
  "core → datasets/warnings.mjs": [4, DATASET_FORMAT],
  "core → portable/assets.mjs": [2, "portable asset references stored with pages"],
  "core → portable/capacity.mjs": [11, CAPACITY],
  "core → portable/cdn-fragment.mjs": [1, "publication writes the CDN reader fragment"],
  "core → portable/component-signature.mjs": [1, "component signatures in catalog metadata"],
  "core → portable/inline.mjs": [1, "conversation previews inline the reader"],
  "core → portable/publication-types.ts": [2, "publication records"],
  "core → portable/reader-bundle.mjs": [2, "exports and previews bundle the offline reader"],
  "core → portable/remote.mjs": [2, "remote resource rules of portable pages"],
  "core → portable/template-bundle.mjs": [3, "template bundle format"],
  "core → portable/validation.mjs": [12, VALIDATION],
  "core → surface/agent-reference.ts": [1, "type only: the canvas reference of an Agent target"],
  "core → surface/component-insertion.ts": [2, "component insertion shared by the editor and page operations"],
  "core → surface/ink-operations.mjs": [1, INK_FORMAT],
  "core → surface/ink-wire.mjs": [3, INK_FORMAT],
  "core → surface/source-runtime.ts": [1, "component source runtime shared with the editor"],
  "datasets → components/assistant-context.ts": [1, DATASET_HOST],
  "datasets → components/blocks/action-host.tsx": [1, DATASET_HOST],
  "datasets → components/blocks/database-host.ts": [1, DATASET_HOST],
  "datasets → components/blocks/types.ts": [2, DATASET_HOST],
  "datasets → components/custom/CustomBlock.tsx": [1, DATASET_HOST],
  "datasets → components/local-resources.tsx": [2, DATASET_HOST],
  "datasets → portable/capacity.mjs": [1, CAPACITY],
  "design → desktop/assets/icon-light.svg": [1, "the app icon is generated into desktop/assets for the packaged App"],
  "design → desktop/assets/icon.svg": [1, "the app icon is generated into desktop/assets for the packaged App"],
  "document → contract/types.ts": [1, "type only: an outline renderer is stored as a custom component reference"],
  "document → surface/portable-ink.mjs": [1, `drawing hit tests and bounds: ${INK_FORMAT}`],
  "host → surface/inline-ink.ts": [2, "type only: the preload exposes the inline ink bridge, typed with the ink runtime"],
  "lib → document/rich-text.mjs": [2, "lib/document.ts and lib/markdown.ts build pages from Markdown"],
  "lib → portable/assets.mjs": [1, "lib/artifact.ts embeds page images into an exported artifact"],
  "lib → portable/validation.mjs": [2, "lib/artifact.ts injects artifacts with the portable HTML rules"],
  "portable → agent-host/types.ts": [1, "type only: a conversation reference names its Agent target"],
  "server → portable/capacity.mjs": [6, CAPACITY],
  "sync → agent-host/storage.ts": [1, "type only: hosted model credentials broker"],
  "sync → agent-host/types.ts": [1, "type only: model sources synced as account resources"],
  "sync → datasets/operations.mjs": [1, DATASET_FORMAT],
  "sync → portable/capacity.mjs": [1, CAPACITY],
  "sync → portable/validation.mjs": [2, VALIDATION],
  "types.ts → contract/types.ts": [1, "type only: the shared page types name component references"],
  "types.ts → document/types.ts": [1, "type only: the shared page types name layout and views"],
  "types.ts → portable/publication-types.ts": [1, "type only: publication records"],
  "types.ts → portable/reference-snapshot.mjs": [1, "type only (import() query): reference snapshots stored with pages"],
};

// The SDK source tables ship component sources as text (`?raw`) into the
// component sandbox, which compiles them with its own module map. Shipping
// source text is not a code dependency, so these imports are their own
// category and never count against the layers.
const SHIPPED_SOURCE_TABLES = [
  "core/builtin-sources.ts",
  "core/g2-builtin-sources.ts",
  "core/diagram-builtin-sources.ts",
];

/** npm packages the document layer may use, and whether values may be imported. */
const DOCUMENT_PACKAGES: Record<string, "value" | "type"> = {
  "@dagrejs/dagre": "value",
  "@tiptap/core": "type",
  // Markdown and formula syntax of rich text (rich-text.mjs, markdown-math.mjs).
  marked: "value",
  katex: "value",
  // richTextStyle returns a CSSProperties object.
  react: "type",
};

/** Imports that still leave the document layer, keyed by importing file and specifier. */
const DOCUMENT_EXCEPTIONS: Record<string, string> = {
  "document/drawing-geometry.mjs → ../surface/portable-ink.mjs":
    "hit tests and bounds of portable ink strokes need the ink formats, which stay in surface this round",
  "document/page-outline.d.mts → ../contract/types":
    "type only: an outline renderer is stored as a custom component reference",
};

/** npm packages the contract layer and the built-in contracts may use. */
const CONTRACT_PACKAGES: Record<string, "value" | "type"> = {
  ajv: "value",
  zod: "value",
  "@tiptap/core": "type",
};

/** Imports that leave the contract layer or a built-in contract, by file and specifier. */
const CONTRACT_EXCEPTIONS: Record<string, string> = {
  "contract/contract.ts → ../portable/capacity.mjs":
    "byte and depth limits of stored content; capacity.mjs stays in portable this round",
  "contract/schema.ts → ../portable/capacity.mjs":
    "byte and depth limits of stored content; capacity.mjs stays in portable this round",
  "contract/contributions.ts → ../datasets/value-types.mjs":
    "value kinds and operators of shared data that contributions declare",
  "contract/types.ts → ../portable/template-bundle.mjs":
    "type only: template metadata carries the template bundle stage and source types",
  "components/blocks/database-contract.mjs → ../../datasets/value-types.mjs":
    "the database contract validates fields against the shared data value kinds",
  "components/blocks/database-contract.mjs → ../../datasets/record-query.mjs":
    "the database contract validates filters and sorts with the shared record query rules",
  "components/blocks/database-contract.mjs → ../../datasets/derived-fields.mjs":
    "the database contract validates rollups with the shared derived field rules",
  "components/blocks/primitive-contract.mjs → ../../surface/native-ink.mjs":
    "image annotations are native ink; the ink formats stay in surface this round",
  "components/blocks/research-contract.mjs → ../../portable/capacity.mjs":
    "byte limits of embedded research media; capacity.mjs stays in portable this round",
};

/** Modules in src/surface that the library, runtime, agent and portable layers import. */
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
const SURFACE_IMPORTERS = ["core", "agent", "agent-host", "sync", "datasets", "portable"];

const src = import.meta.dirname;
const sourceFile = /\.(ts|tsx|mjs|mts)$/;
const isTest = (path: string) =>
  /\.test\.tsx?$|\.fixture\.|\/fixtures\//.test(path) ||
  name(path).startsWith("test/");
const name = (path: string) => relative(src, path).split("\\").join("/");

function files(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) return files(path);
    return sourceFile.test(entry) && !isTest(path) ? [path] : [];
  });
}

interface ImportRecord {
  file: string;
  specifier: string;
  typeOnly: boolean;
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

const suffixes = ["", ".ts", ".tsx", ".mjs", ".d.mts", "/index.ts", "/index.tsx"];
function resolveRelative(file: string, specifier: string) {
  const target = resolve(dirname(file), specifier.split("?")[0]);
  const match = suffixes.find((suffix) => {
    const path = target + suffix;
    return existsSync(path) && statSync(path).isFile();
  });
  return match === undefined ? null : target + match;
}

/** A built-in block's validator, kept beside its component but importable from below. */
const isBuiltinContract = (module: string) =>
  /^components\/blocks\/(?:[\w-]+\/)*(?:[\w-]+-)?contract\.(?:mjs|d\.mts)$/.test(
    module,
  ) || BUILTIN_CONTRACT_HELPERS.includes(module);

/** importing directory: a top-level directory or file, or a part of components. */
function area(module: string) {
  const parts = module.split("/");
  if (parts.length === 1) return module;
  if (
    parts[0] === "components" &&
    parts.length > 2 &&
    ["custom", "blocks", "rich-text"].includes(parts[1])
  )
    return `components/${parts[1]}`;
  return parts[0];
}

const layerOfArea = new Map(
  LAYERS.flatMap(([layer, areas], index) =>
    areas.map((entry) => [entry, { layer, index }] as const),
  ),
);
const contractLayer = LAYERS.findIndex(([layer]) => layer === "contract");
function layerIndex(module: string) {
  if (isBuiltinContract(module)) return contractLayer;
  return layerOfArea.get(area(module))?.index;
}

/** Relative imports of non-test files under `roots` that land inside src. */
function sourceImports(roots: string[]) {
  return roots.flatMap((root) =>
    files(join(src, root)).flatMap((file) =>
      imports(file)
        .filter((record) => record.specifier.startsWith("."))
        .map((record) => ({
          ...record,
          importer: name(file),
          target: resolveRelative(file, record.specifier),
        })),
    ),
  );
}

/** Checks one layer's own imports against its packages and exceptions. */
function closedLayer(
  modules: (module: string) => boolean,
  allowed: (target: string) => boolean,
  packages: Record<string, "value" | "type">,
  exceptions: Record<string, string>,
) {
  const violations: string[] = [];
  const used = new Set<string>();
  for (const file of files(src).filter((path) => modules(name(path))))
    for (const record of imports(file)) {
      const key = `${name(file)} → ${record.specifier}`;
      if (!record.specifier.startsWith(".")) {
        const kind = packages[record.specifier];
        if (kind === "value" || (kind === "type" && record.typeOnly)) continue;
      } else {
        const target = resolveRelative(file, record.specifier);
        if (!target) {
          violations.push(`${key} (unresolved)`);
          continue;
        }
        if (allowed(name(target))) continue;
      }
      if (key in exceptions) {
        used.add(key);
        continue;
      }
      violations.push(key);
    }
  return { violations, used: [...used].sort() };
}

describe("source layers", () => {
  test("every source file belongs to a declared layer", () => {
    const undeclared = files(src)
      .map(name)
      .filter((module) => layerIndex(module) === undefined);
    expect([...new Set(undeclared.map(area))]).toEqual([]);
  });

  test("relative imports resolve", () => {
    const unresolved = sourceImports(["."])
      .filter((record) => !record.target)
      .map((record) => `${record.importer} → ${record.specifier}`);
    expect(unresolved.sort()).toEqual([...NOT_IMPORTS].sort());
  });

  test("imports point down or stay in their layer, apart from the ratchet", () => {
    const actual: Record<string, number> = {};
    for (const record of sourceImports(["."])) {
      if (!record.target) continue;
      const target = name(record.target);
      if (target.startsWith("..")) continue;
      if (
        SHIPPED_SOURCE_TABLES.includes(record.importer) &&
        record.specifier.includes("?raw")
      )
        continue;
      if (layerIndex(target)! <= layerIndex(record.importer)!) continue;
      const key = `${area(record.importer)} → ${target}`;
      actual[key] = (actual[key] ?? 0) + 1;
    }
    const expected = Object.fromEntries(
      Object.entries(RATCHET).map(([key, [count]]) => [key, count]),
    );
    // Report keys in ratchet form so a removal is one edit.
    const lines = (map: Record<string, number>) =>
      Object.entries(map)
        .map(([key, count]) => `${key}: ${count}`)
        .sort();
    expect(lines(actual)).toEqual(lines(expected));
  });

  test("shipped source tables import other sources only as text", () => {
    const code = sourceImports(SHIPPED_SOURCE_TABLES)
      .filter((record) => !record.specifier.includes("?raw"))
      .map((record) => `${record.importer} → ${record.specifier}`);
    expect(code.sort()).toEqual([
      "core/builtin-sources.ts → ../components/blocks/g2/exports-map.json",
      "core/builtin-sources.ts → ./diagram-builtin-sources",
      "core/builtin-sources.ts → ./g2-builtin-sources",
    ]);
  });
});

describe("document layer", () => {
  test("imports only itself, src/types.ts and listed npm packages", () => {
    const { violations, used } = closedLayer(
      (module) => area(module) === "document",
      (target) => area(target) === "document" || target === "types.ts",
      DOCUMENT_PACKAGES,
      DOCUMENT_EXCEPTIONS,
    );
    expect(violations).toEqual([]);
    // An exception nobody needs any more is removed, so the list stays minimal.
    expect(used).toEqual(Object.keys(DOCUMENT_EXCEPTIONS).sort());
  });

  test("lower layers import an exact list of surface modules", () => {
    const surface = new Set(
      sourceImports(SURFACE_IMPORTERS)
        .map((record) => record.target && name(record.target))
        .filter((target): target is string => !!target?.startsWith("surface/")),
    );
    // Adding a surface import to these layers is a deliberate decision: list
    // it here. Removing one shortens the list.
    expect([...surface].sort()).toEqual([...SURFACE_IMPORTS_FROM_LOWER_LAYERS].sort());
  });
});

describe("component contract", () => {
  const contractTarget = (target: string) =>
    ["contract", "document", "lib"].includes(area(target)) ||
    target === "types.ts" ||
    isBuiltinContract(target) ||
    // Built-in component metadata (contract/catalog.ts).
    /^\.\.\/resources\/catalog\/[\w-]+\.json$/.test(target);

  test("src/contract imports only the contract, document, lib and pure packages", () => {
    const { violations, used } = closedLayer(
      (module) => area(module) === "contract",
      contractTarget,
      CONTRACT_PACKAGES,
      CONTRACT_EXCEPTIONS,
    );
    expect(violations).toEqual([]);
    expect(used).toEqual(
      Object.keys(CONTRACT_EXCEPTIONS)
        .filter((key) => key.startsWith("contract/"))
        .sort(),
    );
  });

  test("built-in block contracts import only contracts, document, lib and pure packages", () => {
    const { violations, used } = closedLayer(
      isBuiltinContract,
      contractTarget,
      CONTRACT_PACKAGES,
      CONTRACT_EXCEPTIONS,
    );
    expect(violations).toEqual([]);
    expect(used).toEqual(
      Object.keys(CONTRACT_EXCEPTIONS)
        .filter((key) => key.startsWith("components/"))
        .sort(),
    );
  });

  test("core, document, agent and portable reach components only through contracts", () => {
    const reached = sourceImports(["core", "document", "agent", "portable"])
      .filter(
        (record) =>
          !(
            SHIPPED_SOURCE_TABLES.includes(record.importer) &&
            record.specifier.includes("?raw")
          ),
      )
      .map((record) => record.target && name(record.target))
      .filter(
        (target): target is string =>
          !!target?.startsWith("components/custom/"),
      );
    // The component runtime (custom blocks in a frame) is not the contract.
    expect([...new Set(reached)].sort()).toEqual(
      ["components/custom/CustomBlock.tsx", "components/custom/component-index.ts"],
    );
  });
});

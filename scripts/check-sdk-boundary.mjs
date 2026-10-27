// Compile one custom component against showai:components with the product's
// own compiler (compilePackage and its showai-component-boundary plugin),
// bundled the way the CLI build embeds the ?raw SDK sources. An SDK module that
// imports something outside the shipped built-in sources fails here in seconds
// instead of in every component compile test.
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rawSourcePlugin } from "./raw-source-plugin.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const started = performance.now();
// The bundled compiler resolves React, Tiptap and the other runtimes from its
// own location, as the shipped CLI does; a runtime directory inherited from a
// dev or App session would compile against another tree.
delete process.env.SHOWAI_RUNTIME_ENTRY;
delete process.env.SHOWAI_DEV_RUNTIME;
// Inside node_modules so the bundle finds this checkout's packages.
const cache = join(root, "node_modules/.cache");
await mkdir(cache, { recursive: true });
const working = await mkdtemp(join(cache, "showai-sdk-boundary-"));

// Map virtual SDK paths back to repository files for the failure report.
async function sdkSourcePaths() {
  const paths = new Map();
  for (const name of [
    "builtin-sources.ts",
    "g2-builtin-sources.ts",
    "diagram-builtin-sources.ts",
  ]) {
    const text = await readFile(join(root, "src/core", name), "utf8");
    const imports = new Map(
      [...text.matchAll(/^import (\w+) from "([^"]+)\?raw";$/gm)].map(
        ([, binding, path]) => [
          binding,
          relative(root, resolve(root, "src/core", path)),
        ],
      ),
    );
    for (const [, key, binding] of text.matchAll(/^\s*"([^"]+)": (\w+),$/gm))
      if (imports.has(binding)) paths.set(key, imports.get(binding));
  }
  return paths;
}

try {
  const harness = join(working, "compiler.mjs");
  await build({
    stdin: {
      contents: `export { compilePackage } from "./src/core/catalog.ts";
export { builtinSources } from "./src/core/builtin-sources.ts";`,
      resolveDir: root,
      sourcefile: "sdk-boundary-harness.ts",
      loader: "ts",
    },
    outfile: harness,
    platform: "node",
    target: "node22",
    format: "esm",
    bundle: true,
    external: ["esbuild"],
    plugins: [rawSourcePlugin],
    banner: {
      js: 'import { createRequire as __showaiCreateRequire } from "node:module"; const require = __showaiCreateRequire(import.meta.url);',
    },
    logLevel: "silent",
  });
  const { compilePackage, builtinSources } = await import(
    pathToFileURL(harness).href
  );
  // A re-export of a missing TypeScript binding bundles without an error.
  if (typeof compilePackage !== "function")
    throw new Error(
      "src/core/catalog.ts no longer exports compilePackage, the compiler this check runs.",
    );
  const manifest = {
    id: "sdk-boundary-probe",
    name: "SDK boundary probe",
    version: "1.0.0",
    description: "Compiles against every export of the built-in SDK.",
    entry: "index.tsx",
    scenarios: ["SDK boundary check"],
    defaultData: {},
    examples: [{ name: "Empty", data: {} }],
  };
  const schema = {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
  // Bundling resolves every import the SDK reaches; the namespace import also
  // keeps every export live, as a component using any of them would.
  const files = new Map([
    [
      "index.tsx",
      Buffer.from(
        'import * as SDK from "showai:components";export default function Probe(){return <output>{Object.keys(SDK).length}</output>;}',
      ),
    ],
  ]);
  await compilePackage(working, manifest, schema, files, "project", working);
  console.log(
    `SDK boundary OK: a component importing showai:components compiled with the product compiler (${Object.keys(builtinSources).length} shipped SDK files, ${((performance.now() - started) / 1000).toFixed(1)}s).`,
  );
} catch (error) {
  process.exitCode = 1;
  // Boundary errors carry the importing SDK module as their location.
  const outside = (error?.errors ?? []).filter(
    (message) =>
      message.pluginName === "showai-component-boundary" &&
      message.location?.file.startsWith("showai-builtin:"),
  );
  if (outside.length) {
    const paths = await sdkSourcePaths();
    console.error(
      "SDK boundary check failed: the built-in SDK (showai:components) imports modules that are not shipped with it.",
    );
    for (const { location, text } of outside) {
      const sdkFile = location.file.slice("showai-builtin:".length);
      console.error(
        `  ${paths.get(sdkFile) ?? sdkFile}:${location.line}:${location.column + 1} (SDK file ${sdkFile})`,
      );
      console.error(`    ${text}`);
      console.error(`    > ${location.lineText.trim()}`);
    }
    console.error(
      "Ship each imported module in src/core/builtin-sources.ts (and rewrite the import to its SDK path), provide a package through compilePackage in src/core/catalog.ts, or import from a module the SDK already ships. Until then every custom component that imports showai:components fails to compile.",
    );
  }
  if (!outside.length || outside.length < error.errors.length) {
    console.error("SDK boundary check could not compile the SDK probe:");
    // esbuild failures already list each message with its location.
    console.error(error?.errors ? error.message : (error?.stack ?? error));
  }
} finally {
  await rm(working, { recursive: true, force: true });
}

import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const provenance = JSON.parse(
  await readFile(
    new URL(
      "../resources/catalog/text-diagram/vendor/provenance.json",
      import.meta.url,
    ),
  ),
);
const installed = JSON.parse(
  await readFile(
    new URL("../node_modules/@dagrejs/dagre/package.json", import.meta.url),
  ),
);
if (installed.version !== provenance.dagre)
  throw new Error(
    "Dagre changed: review the diagram engine and update provenance before rebuilding.",
  );
await build({
  stdin: {
    contents: "export {default} from '@dagrejs/dagre';",
    resolveDir: new URL("..", import.meta.url).pathname,
    sourcefile: "dagre-entry.js",
  },
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  outfile: new URL(
    "../resources/catalog/text-diagram/vendor/dagre.js",
    import.meta.url,
  ).pathname,
  legalComments: "inline",
});

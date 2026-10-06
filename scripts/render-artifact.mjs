#!/usr/bin/env node
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_ARTIFACT_BYTES,
  injectArtifactIntoHtml,
  parseArtifact,
} from "../src/portable/validation.mjs";

import { assertOfflineImages } from "../src/portable/assets.mjs";
import { toInlineFragment } from "../src/portable/inline.mjs";
import { bundleReader } from "../src/portable/reader-bundle.mjs";

const inline = process.argv.includes("--inline");
const args = process.argv.slice(2).filter((arg) => arg !== "--inline");
if (args.includes("--help") || args.length < 2 || args.length > 3) {
  console.log(
    "Usage: node render-artifact.mjs input.showai.json output.html [viewer-template.html] [--inline]\nCreates a standalone page, or an inline conversation fragment with --inline. Images must be embedded.\nBuild the viewer first with npm run build:portable, or use the packaged plugin command.",
  );
  process.exit(args.includes("--help") ? 0 : 1);
}
const [inputPath, outputPath, explicitTemplate] = args;
if (resolve(inputPath) === resolve(outputPath))
  throw new Error("Input and output must be different files.");
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const candidates = explicitTemplate
  ? [resolve(explicitTemplate)]
  : [
      join(packageRoot, "assets/viewer.html"),
      join(packageRoot, "dist-portable/portable.html"),
    ];
let templatePath;
for (const candidate of candidates) {
  const exists = await stat(candidate).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  if (exists) {
    templatePath = candidate;
    break;
  }
}
if (!templatePath)
  throw new Error(
    "No bundled viewer found. Run npm run build:portable or npm run build before exporting.",
  );
if ((await stat(inputPath)).size > MAX_ARTIFACT_BYTES)
  throw new Error("Artifact exceeds the 10 MB limit.");
const artifact = parseArtifact(await readFile(inputPath, "utf8"));
assertOfflineImages(artifact.document);
const html = injectArtifactIntoHtml(
  !explicitTemplate &&
    (await stat(join(dirname(templatePath), "reader-source.json")).then(
      () => true,
      (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    ))
    ? await bundleReader(join(dirname(templatePath), "reader-source.json"), [
        artifact.document,
      ])
    : await readFile(templatePath, "utf8"),
  artifact.document,
  artifact.components,
  artifact.remoteComponents,
  artifact.presentation,
  artifact.selection,
);
await mkdir(dirname(resolve(outputPath)), { recursive: true });
const output = inline ? toInlineFragment(html) : html;
await writeFile(outputPath, output, "utf8");
console.log(
  `Saved ${resolve(outputPath)} (${(Buffer.byteLength(output) / 1024).toFixed(0)} KB${inline ? ", inline" : ""})`,
);

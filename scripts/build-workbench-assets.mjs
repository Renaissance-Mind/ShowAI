import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { gzipSync } from "node:zlib";
import { parseSync } from "rolldown/utils";
import { build } from "vite";

const specifier = (name) => "@showai/workbench/" + name;

function stringValue(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && !node.expressions.length)
    return node.quasis[0].value.cooked;
}

function transformChunk(chunk, names, files) {
  const imports = new Set();
  const replacements = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const source = stringValue(node.source);
    if (source?.startsWith(".")) {
      const name = posix.normalize(posix.join(posix.dirname(chunk.fileName), source));
      if (names.has(name)) {
        if (node.type === "ImportExpression")
          replacements.push([node.start, node.end,
            `globalThis.__SHOWAI_CODEX_HOST__.importAsset(${JSON.stringify(name)})`]);
        else if (node.type === "ImportDeclaration" || node.type.startsWith("Export")) {
          imports.add(name);
          replacements.push([node.source.start, node.source.end, JSON.stringify(specifier(name))]);
        }
      }
    }
    if (node.type === "NewExpression" && node.callee.name === "URL") {
      const [path, base] = node.arguments;
      const literal = stringValue(path);
      if (literal && base?.object?.type === "MetaProperty" && base.property?.name === "url") {
        const name = posix.normalize(posix.join(posix.dirname(chunk.fileName), literal));
        const asset = files.get(name);
        if (asset) {
          const mime = name.endsWith(".svg") ? "image/svg+xml" : "text/javascript";
          const dataUrl = `data:${mime};base64,${Buffer.from(asset.source).toString("base64")}`;
          replacements.push([node.start, node.end, `new URL(${JSON.stringify(dataUrl)})`]);
        }
      }
    }
    for (const item of Object.values(node)) visit(item);
  }
  visit(parseSync(chunk.fileName, chunk.code).program);
  let code = chunk.code;
  for (const [start, end, value] of replacements.sort(([a], [b]) => b - a))
    code = code.slice(0, start) + value + code.slice(end);
  return { code, imports: [...imports] };
}

export async function buildWorkbenchAssets(directory) {
  const bundle = await build({
    publicDir: false,
    build: { write: false, modulePreload: false, cssCodeSplit: false, assetsInlineLimit: () => true },
  });
  const output = (Array.isArray(bundle) ? bundle : [bundle]).flatMap((value) => value.output);
  const chunks = output.filter((item) => item.type === "chunk");
  const style = output.find((item) => item.type === "asset" && item.fileName.endsWith(".css"));
  const entry = chunks.find((chunk) => chunk.isEntry);
  if (!entry || !style) throw new Error("The Codex workbench bundle has no entry or stylesheet.");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const names = new Set(chunks.map((chunk) => chunk.fileName));
  const files = new Map(output.filter((item) => item.type === "asset").map((item) => [item.fileName, item]));
  const assets = [];
  async function store(name, contents, imports) {
    const bytes = gzipSync(contents);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(directory, sha256 + ".gz"), bytes);
    assets.push([name, { sha256, bytes: bytes.length, imports }]);
  }
  for (const chunk of chunks) {
    const { code, imports } = transformChunk(chunk, names, files);
    await store(chunk.fileName, code, imports);
  }
  await store(style.fileName, style.source, []);
  await writeFile(join(directory, "index.json"), JSON.stringify({
    entry: entry.fileName,
    style: style.fileName,
    assets: Object.fromEntries(assets),
  }) + "\n");
  console.log(`Prepared ${assets.length} Codex workbench assets.`);
}

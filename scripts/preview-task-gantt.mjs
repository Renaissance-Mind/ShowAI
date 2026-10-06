import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
const destination = resolve(process.argv[2] ?? "output/task-gantt-inline.html");
const result = await build({
  entryPoints: ["examples/task-gantt/preview.tsx"],
  bundle: true,
  write: false,
  outdir: "preview",
  format: "iife",
  minify: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
});
const script = result.outputFiles
  .find((file) => file.path.endsWith(".js"))
  .text.replaceAll("</script", "<\\/script");
const css = result.outputFiles.find((file) => file.path.endsWith(".css")).text;
const fragment = `<div id="showai-task-gantt-preview" style="width:100%;min-width:0"></div>\n<style>${css}</style>\n<script>${script}</script>\n`;
if (Buffer.byteLength(fragment) > 1_000_000)
  throw new Error("Inline preview exceeds 1 MB");
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, fragment);
await writeFile(
  destination.replace(/\.html$/, ".standalone.html"),
  `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>任务管理甘特图</title><style>body{margin:0;padding:16px;background:light-dark(#f7f7fa,#141418);color-scheme:light dark}</style></head><body>${fragment}</body></html>`,
);
console.log(destination);

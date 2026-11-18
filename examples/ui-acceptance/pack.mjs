import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function buildReview(
  appHtml,
  { title, lang = "", revision = "" } = {},
) {
  const [style, script] = await Promise.all([
    readFile(new URL("./inspector.css", import.meta.url), "utf8"),
    readFile(new URL("./inspector.js", import.meta.url), "utf8"),
  ]);
  const payload = JSON.stringify({ appHtml, title, lang }).replace(
    /</g,
    "\\u003c",
  );
  const version = String(revision).replace(/[^0-9a-f]/gi, "");
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; frame-src 'self' about:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'\">" +
    '<meta name="showai-source-revision" content="' +
    version +
    '"><title>UI review</title><style>' +
    style +
    "</style></head><body>" +
    '<div id="review-root"></div><script id="review-app" type="application/json">' +
    payload +
    "</script><script>" +
    script.replace(/<\/script/gi, "<\\/script") +
    "</script></body></html>\n"
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || resolve(input) === resolve(output))
    throw new Error("Usage: node pack.mjs <app.html> <preview.html>");
  const html = await buildReview(await readFile(input, "utf8"));
  const temporary = resolve(output) + "." + process.pid + ".tmp";
  await writeFile(temporary, html);
  await rename(temporary, resolve(output));
}

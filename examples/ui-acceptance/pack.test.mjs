import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildReview, findExternalAssets } from "./pack.mjs";

test("the copyable example embeds the current app and inspector", async () => {
  const app = await readFile(new URL("./search.html", import.meta.url), "utf8");
  const preview = await readFile(
    new URL("./preview.html", import.meta.url),
    "utf8",
  );
  const payload = preview.match(
    /<script id="review-app" type="application\/json">([^<]+)<\/script>/,
  );
  assert.ok(payload);
  const config = JSON.parse(payload[1]);
  assert.equal(config.appHtml, app);
  assert.equal(
    await buildReview(app, {
      title: config.title,
      lang: config.lang,
      metadata: config.metadata,
    }),
    preview,
  );
  assert.doesNotMatch(
    preview,
    /<(?:script|link|iframe)\b[^>]*\s(?:src|href)=/i,
  );
});

test("external assets in the embedded page are reported before packaging", async () => {
  const app = `<!doctype html><html><head>
    <link rel="stylesheet" href="/app.css">
    <style>main { background: url("./background.png"); }</style>
    <script src="/app.js"></script>
  </head><body><img src="photo.png"></body></html>`;
  assert.deepEqual(findExternalAssets(app), [
    "script: /app.js",
    "CSS url: ./background.png",
    "link href: /app.css",
    "img src: photo.png",
  ]);
  await assert.rejects(buildReview(app), /external assets.*\n.*app\.js/s);
  assert.deepEqual(
    findExternalAssets(`<style>.x { background: url("data:image/png;base64,AAAA"); }</style>
      <script>const text = '<img src="example.png">';</script>
      <a href="/other-page">Page</a>
      <link rel="canonical" href="https://example.com/page">`),
    [],
  );
  assert.deepEqual(
    findExternalAssets(`<script src="data:text/javascript,alert(1)"></script>
      <link rel="stylesheet" href="data:text/css,body{}">
      <style>@import url("data:text/css,body{}");</style>`),
    [
      "script: data:text/javascript,alert(1)",
      "CSS @import: data:text/css,body{}",
      "link href: data:text/css,body{}",
    ],
  );
  assert.deepEqual(
    findExternalAssets(
      '<img srcset="data:image/png;base64,AAAA 1x, /large.png 2x">',
    ),
    ["img srcset: /large.png"],
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildReview, findExternalAssets } from "./pack.mjs";

function reviewConfig(html) {
  const payload = html.match(
    /<script id="review-app" type="application\/json">([^<]+)<\/script>/,
  );
  assert.ok(payload);
  return JSON.parse(payload[1]);
}

test("the copyable example embeds the current app and inspector", async () => {
  const app = await readFile(new URL("./search.html", import.meta.url), "utf8");
  const preview = await readFile(
    new URL("./preview.html", import.meta.url),
    "utf8",
  );
  const config = reviewConfig(preview);
  assert.equal(config.appHtml, app);
  assert.equal(
    await buildReview(app, {
      title: config.title,
      lang: config.lang,
      metadata: config.metadata,
      flow: config.flow,
    }),
    preview,
  );
  assert.doesNotMatch(
    preview,
    /<(?:script|link|iframe)\b[^>]*\s(?:src|href)=/i,
  );
  assert.deepEqual(
    config.flow.nodes.map(({ id }) => id),
    ["all", "matches", "empty"],
  );
  for (const node of config.flow.nodes) {
    assert.match(node.image, /^data:image\/jpeg;base64,\/9j\//);
    assert.ok(node.width > 0 && node.height > 0);
  }
  assert.deepEqual(
    config.flow.edges
      .filter(({ kind }) => kind === "back")
      .map(({ from, to }) => [from, to]),
    [
      ["matches", "all"],
      ["empty", "all"],
    ],
  );
  const legacy = await buildReview(app, {
    title: config.title,
    lang: config.lang,
    flow: false,
  });
  assert.doesNotMatch(legacy, /function createReviewFlowCanvas\(/);
});

test("standard builds capture the declared flow canvas", async () => {
  const app = await readFile(new URL("./search.html", import.meta.url), "utf8");
  const source = fileURLToPath(new URL("../../", import.meta.url));
  const { flow } = reviewConfig(
    await buildReview(app, { source, lang: "zh-CN" }),
  );
  assert.deepEqual(
    flow.nodes.map(({ id, title }) => [id, title]),
    [
      ["all", "全部页面"],
      ["matches", "有匹配结果"],
      ["empty", "没有匹配结果"],
    ],
  );
  assert.ok(
    flow.nodes.every(({ image }) =>
      image.startsWith("data:image/jpeg;base64,"),
    ),
  );
  assert.equal(flow.edges.length, 4);
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

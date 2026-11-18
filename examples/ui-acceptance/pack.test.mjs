import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildReview } from "./pack.mjs";

test("the copyable example embeds the current app and inspector", async () => {
  const app = await readFile(new URL("./search.html", import.meta.url), "utf8");
  const preview = await readFile(
    new URL("./preview.html", import.meta.url),
    "utf8",
  );
  assert.equal(await buildReview(app), preview);
  const payload = preview.match(
    /<script id="review-app" type="application\/json">([^<]+)<\/script>/,
  );
  assert.ok(payload);
  assert.equal(JSON.parse(payload[1]).appHtml, app);
  assert.doesNotMatch(
    preview,
    /<(?:script|link|iframe)\b[^>]*\s(?:src|href)=/i,
  );
});

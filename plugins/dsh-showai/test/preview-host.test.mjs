import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A fake Host context that records the two effects and the result listener the
 * plugin installs, without depending on a Harness process.
 */
function createContext() {
  const warnings = [];
  const disposers = [];
  const listeners = new Map();
  const routes = new Map();
  return {
    warnings,
    routes,
    listeners,
    ctx: {
      logger: { warn: (message) => warnings.push(String(message)) },
      effect(factory) {
        const dispose = factory();
        if (typeof dispose === "function") disposers.push(dispose);
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      webServer: {
        register(route) {
          routes.set(route.path, route);
          return () => routes.delete(route.path);
        },
      },
    },
    async dispose() {
      for (const dispose of disposers.reverse()) await dispose();
    },
  };
}

/** Build the minimum request/response pair the route handler reads. */
function createExchange(method, url) {
  const response = { status: 0, headers: {}, body: undefined };
  response.writeHead = (status, headers = {}) => {
    response.status = status;
    response.headers = headers;
  };
  response.end = (body) => {
    response.body = body;
  };
  return [{ method, url, headers: {} }, response];
}

/** Poll until the cache contains the named file. */
async function waitForFile(path) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      const info = await stat(path);
      if (info.isFile()) return;
    } catch {
      // not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`cache file did not appear: ${path}`);
}

test("the Host caches complete documents and serves legacy fragments in standards mode", async () => {
  const home = await mkdtemp(join(tmpdir(), "showai-preview-host-"));
  process.env.DSH_HOME = home;
  const cache = join(home, "cache", "showai-page");
  await mkdir(cache, { recursive: true });
  const inline = join(home, "page.inline.html");
  const full = join(home, "page.html");
  await writeFile(
    inline,
    '<section lang="zh" id="root"><p>局部阅读器</p><script type="module">window.__shown = true</script></section>',
  );
  await writeFile(full, "<!doctype html><html><body><p>完整页面</p></body></html>");

  const { apply, completePreviewDocument, PREVIEW_ROUTE } = await import("../index.js");
  const harness = createContext();
  apply(harness.ctx);

  try {
    const listener = harness.listeners.get("tools/result");
    assert.equal(typeof listener, "function");
    listener(
      { callId: "call_test", name: "mcp__showai__page_present", parent: undefined },
      {
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              data: {
                title: '测试 <页面> "A"',
                delivery: { inline, html: full },
              },
            }),
          },
        ],
      },
    );

    const cached = join(cache, "call_test.html");
    await waitForFile(cached);
    const cachedText = await readFile(cached, "utf8");
    assert.match(cachedText, /^<!doctype html>/i);
    assert.match(cachedText, /<html lang="zh">/);
    assert.match(cachedText, /<title>测试 &lt;页面&gt; &quot;A&quot;<\/title>/);
    assert.match(cachedText, /<section lang="zh"/);
    assert.deepEqual(harness.warnings, []);

    // A page presented by a PTC subcall reaches the same keyed Client view, so
    // its result must be cached too; only the wire tool name decides.
    listener(
      { callId: "call_nested", name: "mcp__showai__render_document", parent: { kind: "oneOf" } },
      {
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              data: { title: "嵌套", delivery: { inline } },
            }),
          },
        ],
      },
    );
    const nested = join(cache, "call_nested.html");
    await waitForFile(nested);
    assert.match(await readFile(nested, "utf8"), /^<!doctype html>/i);

    const route = harness.routes.get(PREVIEW_ROUTE);
    assert.equal(route.kind, "prefix");

    const [headRequest, head] = createExchange("HEAD", `${PREVIEW_ROUTE}/call_test.html`);
    await route.handler(headRequest, head);
    assert.equal(head.status, 200);

    const [getRequest, redirect] = createExchange("GET", `${PREVIEW_ROUTE}/call_test.html`);
    await route.handler(getRequest, redirect);
    assert.equal(redirect.status, 302);
    const location = redirect.headers.location;
    assert.match(location, /^http:\/\/127\.0\.0\.1:\d+\/call_test\.html$/);

    const served = await fetch(location).then((response) => response.text());
    assert.match(served, /^<!doctype html>/i);
    assert.match(served, /<title>测试 &lt;页面&gt; &quot;A&quot;<\/title>/);

    // A cache entry written by the previous plugin generation is still a
    // fragment; the origin must upgrade it on read instead of serving quirks.
    await writeFile(
      join(cache, "legacy.html"),
      '<section lang="en" id="legacy"><p>legacy fragment</p></section>',
    );
    const [legacyHeadRequest, legacyHead] = createExchange(
      "HEAD",
      `${PREVIEW_ROUTE}/legacy.html`,
    );
    await route.handler(legacyHeadRequest, legacyHead);
    assert.equal(legacyHead.status, 200);
    const [legacyGetRequest, legacyRedirect] = createExchange(
      "GET",
      `${PREVIEW_ROUTE}/legacy.html`,
    );
    await route.handler(legacyGetRequest, legacyRedirect);
    const legacy = await fetch(legacyRedirect.headers.location).then((response) => response.text());
    assert.match(legacy, /^<!doctype html>/i);
    assert.match(legacy, /<html lang="en">/);
    assert.match(legacy, /legacy fragment/);

    assert.equal(completePreviewDocument("<p>x</p>").subarray(0, 15).toString(), "<!doctype html>");
    assert.equal(
      completePreviewDocument("<!doctype html><html><body>x</body></html>").toString(),
      "<!doctype html><html><body>x</body></html>",
    );
  } finally {
    await harness.dispose();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(home, { recursive: true, force: true });
  }
});

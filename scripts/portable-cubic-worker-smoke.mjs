import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
await mkdir(resolve("output/playwright"), { recursive: true });
const base = process.env.SHOWAI_CUBIC_TEST_URL ?? "http://127.0.0.1:5187";
const browser = await chromium.launch({
  executablePath:
    process.env.SHOWAI_BROWSER_EXECUTABLE ??
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/scripts/fixtures/portable-cubic-worker.html");
  const result = await page.evaluate(async () => {
    "use strict";
    const { createPortableCubicClient, preparedCubicGeometry } =
      await import("/src/surface/portable-cubic-client.mjs");
    const { cubicInkGeometry, cubicInkHit } =
      await import("/src/surface/cubic-ink-core.mjs");
    const client = createPortableCubicClient();
    await client.ready();
    const { PortableInputScope } =
      await import("/src/surface/portable-input-scope.ts");
    const options = {
      strokeId: "browser-actual",
      pageId: "page",
      boardId: "board",
      tool: "pen",
      color: "#123456",
      width: 3,
      pressure: true,
      creationZoom: 2,
      origin: { x: 30, y: 40 },
      name: "Test",
    };
    const points = Array.from({ length: 321 }, (_, i) => ({
      id: i + 1,
      x: i * 0.2,
      y: Math.sin(i / 30),
      time: i / 120,
      force: 0.1 + (i % 7) / 8,
      azimuth: 0.3,
      altitude: 0.8,
    }));
    const first = await client.begin(options, {
      actual: points.slice(0, 30),
      predicted: [{ ...points[30], id: 0 }],
    });
    await client.push(options.strokeId, [
      { actual: points.slice(30, 220), predicted: [] },
      { actual: points.slice(220), predicted: [] },
    ]);
    const sealed = (await client.seal(options.strokeId, [])).sealed;
    const cached = preparedCubicGeometry(sealed.source, 3, true);
    if (!cached)
      throw new Error("Actual sealed source cache binding is missing");
    const independent = cubicInkGeometry(sealed.source, 3, true);
    if (
      JSON.stringify(cached.commands) !==
        JSON.stringify(independent.commands) ||
      JSON.stringify(cached.bounds) !== JSON.stringify(independent.bounds) ||
      cached.path !== independent.path
    )
      throw new Error(
        "Worker final geometry differs from actual independent WASM",
      );
    let mutationRejected = false;
    try {
      sealed.source.capture.raw[0][0] = 999;
    } catch {
      mutationRejected = true;
    }
    let shallowRejected = false;
    try {
      await client.prepare(
        Object.freeze({ ...JSON.parse(JSON.stringify(sealed.source)) }),
        4,
        true,
      );
    } catch {
      shallowRejected = true;
    }
    const styled = await client.prepare(sealed.source, 5, false),
      expected = cubicInkGeometry(sealed.source, 5, false);
    if (styled.path !== expected.path) throw new Error("Worker style differs");
    const hit = cubicInkHit(
      sealed.source,
      {
        x: points[100].x + sealed.source.transform[4],
        y: points[100].y + sealed.source.transform[5],
      },
      3,
      true,
    );
    await client.release(options.strokeId);
    client.close();
    const reserved = [],
      committed = [];
    const scope = new PortableInputScope((accepted) => {
      reserved.push(accepted.strokeId);
      return {
        complete: async (value) => {
          if (value.source.capture.raw[0][0] !== points[0].x)
            throw new Error("Accepted raw input was aliased to its caller");
          committed.push(value.source.capture.sourceID);
        },
        fail: (error) => {
          throw error;
        },
      };
    });
    const borrowedBatch = {
      actual: points.slice(0, 190).map((point) => ({ ...point })),
      predicted: [],
    };
    const a = scope.begin(
      { ...options, strokeId: "accepted-A" },
      borrowedBatch,
    );
    borrowedBatch.actual[0].x = 999;
    const b = scope.begin(
      { ...options, strokeId: "accepted-B" },
      { actual: points.slice(0, 20), predicted: [] },
    );
    a.finish();
    b.finish();
    if (
      JSON.stringify(reserved) !== JSON.stringify(["accepted-A", "accepted-B"])
    )
      throw new Error("Acceptance was not reserved synchronously");
    await scope.flush(false);
    if (
      JSON.stringify(committed) !== JSON.stringify(reserved) ||
      scope.hasContacts
    )
      throw new Error("Accepted source order/barrier differs");
    await scope.close();
    return {
      raw: sealed.source.capture.raw.length,
      segments: sealed.source.segments.length,
      commands: cached.commands.length,
      chunks: cached.chunks.length,
      mutationRejected,
      shallowRejected,
      inside: hit.inside,
      firstGeneration: first.paint.generation,
      reserved,
      committed,
      userAgent: navigator.userAgent,
    };
  });
  assert.equal(result.raw, 321);
  assert.equal(result.segments, 320);
  assert.equal(result.mutationRejected, true);
  assert.equal(result.shallowRejected, true);
  assert.equal(result.inside, true);
  assert.deepEqual(errors, []);
  await writeFile(
    resolve("output/playwright/portable-cubic-worker-result.json"),
    JSON.stringify({ passed: true, result, errors }, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}

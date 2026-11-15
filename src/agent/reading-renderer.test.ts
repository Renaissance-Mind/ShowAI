import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageReadSchema } from "./page-reading";
import { renderReading } from "./reading-renderer";
import { dataServer } from "../test/data-server";

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

test("reading actions wait for a control mounted by the previous action", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-reading-action-"));
  fixtures.push(root);
  const html = join(root, "delayed-control.html");
  await writeFile(
    html,
    `<!doctype html><html><body><main class="portable-app">
<button id="open">Open editor</button><div id="editor"></div>
</main><script>
document.getElementById('open').onclick=()=>setTimeout(()=>{
  const button=document.createElement('button');
  button.textContent='Save changes';
  button.onclick=()=>{document.getElementById('editor').textContent='Changes saved';};
  document.getElementById('editor').append(button);
},500);
</script></body></html>`,
  );
  const result = await renderReading(
    html,
    pageReadSchema.parse({
      view: "html",
      actions: [
        { type: "click", role: "button", name: "Open editor" },
        { type: "click", role: "button", name: "Save changes" },
      ],
    }),
  );
  expect(result.dom[0].accessibility).toContain("Changes saved");
  expect(result.png.subarray(1, 4).toString()).toBe("PNG");
}, 15000);

test("rendered reading settles and captures component iframes below the viewport", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-reading-offscreen-"));
  fixtures.push(root);
  await writeFile(
    join(root, "component.html"),
    `<!doctype html><html><body>
<div id="component-root">The real iframe component has rendered.</div>
<script>window.__SHOWAI_COMPONENT_READING__={ready:true,status:"raw",props:{label:"iframe content"}};</script>
</body></html>`,
  );
  const html = join(root, "long-page.html");
  await writeFile(
    html,
    `<!doctype html><html><body><main class="portable-app">
<h1>Long report</h1>
<div data-block-id="above"><iframe src="./component.html"></iframe></div>
<div style="height:2200px">Long-form report content</div>
<div data-block-id="below"><iframe src="./component.html"></iframe></div>
</main></body></html>`,
  );
  const result = await renderReading(
    html,
    pageReadSchema.parse({
      view: "image",
      viewport: { width: 1000, height: 700 },
    }),
  );
  expect(result.components.map((item) => item.blockId).sort()).toEqual([
    "above",
    "below",
  ]);
  expect(
    result.components.every((item) => item.props.label === "iframe content"),
  ).toBe(true);
  expect(
    result.dom
      .filter((item) => item.blockId)
      .every((item) =>
        item.accessibility.includes("The real iframe component has rendered."),
      ),
  ).toBe(true);
  expect(result.height).toBeGreaterThan(2400);
}, 15000);

test("rendered reading captures content below the viewport inside the reader's scroll shell", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-reading-shell-"));
  fixtures.push(root);
  const html = join(root, "shell.html");
  // Like the portable reader: a 100dvh app whose inner element scrolls.
  await writeFile(
    html,
    `<!doctype html><html><body style="margin:0"><main class="portable-app" style="height:100dvh">
<div style="height:100%;overflow-y:auto">
<div style="height:2600px">Long translated article</div>
<div style="height:200px;overflow:auto"><div style="height:900px">Component with its own scroll</div></div>
</div></main></body></html>`,
  );
  const result = await renderReading(
    html,
    pageReadSchema.parse({
      view: "image",
      viewport: { width: 800, height: 700 },
    }),
  );
  expect(result.height).toBeGreaterThanOrEqual(2800);
  expect(result.height).toBeLessThan(3200);
}, 15000);

test("rendered reading waits for lazily loaded components to replace their placeholder", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-reading-pending-"));
  fixtures.push(root);
  const html = join(root, "lazy-component.html");
  await writeFile(
    html,
    `<!doctype html><html><body><main class="portable-app">
<div data-block-id="flow"><section data-preview-pending="true" role="status">正在加载组件…</section></div>
<button id="reveal">Reveal details</button><div data-block-id="details"></div>
</main><script>
const load=(id,text)=>{
  const owner=document.querySelector('[data-block-id="'+id+'"]');
  owner.innerHTML='<section data-preview-pending="true" role="status">正在加载组件…</section>';
  setTimeout(()=>{owner.textContent=text;},800);
};
load('flow','Flowchart rendered');
document.getElementById('reveal').onclick=()=>load('details','Details rendered');
</script></body></html>`,
  );
  const result = await renderReading(
    html,
    pageReadSchema.parse({
      view: "html",
      actions: [{ type: "click", role: "button", name: "Reveal details" }],
    }),
  );
  expect(result.dom[0].accessibility).toContain("Flowchart rendered");
  expect(result.dom[0].accessibility).toContain("Details rendered");
  expect(result.dom[0].accessibility).not.toContain("正在加载组件");
}, 15000);

test("rendered reading reports components that never finish loading", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-reading-stuck-"));
  fixtures.push(root);
  const html = join(root, "stuck-component.html");
  await writeFile(
    html,
    `<!doctype html><html><body><main class="portable-app">
<div data-block-id="ready">Table rendered</div>
<div data-block-id="overview-flow"><section data-preview-pending="true" role="status">正在加载组件…</section></div>
</main></body></html>`,
  );
  await expect(
    renderReading(html, pageReadSchema.parse({ view: "image" })),
  ).rejects.toThrow(/still loading after 10s: overview-flow\./);
}, 25000);

test("rendered reading reports the requested locale to the page and its component frames", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-reading-locale-"));
  fixtures.push(root);
  const report = `<script>document.getElementById('component-root').textContent=
  'locale '+navigator.language+' '+new Intl.NumberFormat().resolvedOptions().locale;
window.__SHOWAI_COMPONENT_READING__={ready:true,status:"raw",props:{}};</script>`;
  await writeFile(
    join(root, "component.html"),
    `<!doctype html><html><body><div id="component-root"></div>${report}</body></html>`,
  );
  const html = join(root, "reader.html");
  // Like the portable reader without a recorded <html lang>: the browser decides.
  await writeFile(
    html,
    `<!doctype html><html><body><main class="portable-app">
<div id="component-root"></div>
<div data-block-id="matrix"><iframe src="./component.html"></iframe></div>
</main>${report}</body></html>`,
  );
  const options = pageReadSchema.parse({ view: "html" });
  for (const locale of ["zh-CN", "en"] as const) {
    const result = await renderReading(html, options, locale);
    expect(result.dom.map((frame) => frame.accessibility)).toEqual([
      expect.stringContaining(`locale ${locale} ${locale}`),
      expect.stringContaining(`locale ${locale} ${locale}`),
    ]);
  }
}, 30000);

test("rendered reading loads online images but no other online requests", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const server = await dataServer((request, response) => {
    if (request.url === "/plot.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(png);
    } else if (request.url === "/tracker.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end("document.title='tracked'");
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    }
  });
  const root = await mkdtemp(join(tmpdir(), "showai-reading-online-"));
  fixtures.push(root);
  const html = join(root, "online.html");
  await writeFile(
    html,
    `<!doctype html><html><body><main class="portable-app">
<img alt="plot" src="${server.origin}/plot.png" onload="document.getElementById('state').textContent='image loaded '+this.naturalWidth">
<img alt="broken" src="${server.origin}/missing.png">
<p id="state">waiting</p><p id="data">no data</p>
</main>
<script src="${server.origin}/tracker.js"></script>
<script>fetch("${server.origin}/data.json").then(()=>{document.getElementById('data').textContent='data fetched'},()=>{document.getElementById('data').textContent='data blocked'});</script>
</body></html>`,
  );
  try {
    const result = await renderReading(
      html,
      pageReadSchema.parse({ view: "html" }),
    );
    expect(result.dom[0].accessibility).toContain("image loaded 1");
    expect(result.dom[0].accessibility).toContain("data blocked");
    const urls = server.requests.map((request) => request.url);
    expect(urls).toContain("/plot.png");
    expect(urls).not.toContain("/tracker.js");
    expect(urls).not.toContain("/data.json");
  } finally {
    await server.close();
  }
}, 30000);

test("viewport capture keeps CSS viewport geometry while full capture reports expansion", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-reading-viewport-"));
  fixtures.push(root);
  const html = join(root, "viewport.html");
  await writeFile(
    html,
    `<!doctype html><style>body{margin:0}.portable-app{height:100dvh;overflow:auto}.figure{height:50vh;width:400px}</style><main class="portable-app">
<div data-block-id="figure" class="figure">Figure</div><div style="height:1200px">Body</div><p data-block-id="explanation">Explanation</p></main>`,
  );
  const options = {
    view: "image" as const,
    viewport: { width: 800, height: 600 },
    inspect: {
      layout: true as const,
      blockIds: ["figure", "explanation", "absent"],
    },
  };
  const fixed = await renderReading(
    html,
    pageReadSchema.parse({ ...options, capture: "viewport" }),
  );
  expect([fixed.width, fixed.height]).toEqual([800, 600]);
  expect(fixed.capture.expanded).toBe(false);
  expect(fixed.layout?.blocks[0]).toMatchObject({
    rect: { height: 300 },
    visibleFraction: 1,
    viewportHeightRatio: 0.5,
  });
  expect(fixed.layout?.blocks[1]).toMatchObject({ visibleFraction: 0 });
  expect(fixed.layout?.blocks[2]).toEqual({
    blockId: "absent",
    status: "not-rendered",
  });
  const full = await renderReading(html, pageReadSchema.parse(options));
  expect(full.height).toBeGreaterThan(1200);
  expect(full.capture.expanded).toBe(true);
  expect(full.capture.requestedViewport.height).toBe(600);
  // Inspection describes the requested viewport, not the resized screenshot.
  expect(full.layout?.blocks[0]).toMatchObject({ rect: { height: 300 } });
}, 15000);

test("layout accounts for ancestor clipping and scrolling without removing surrounding content", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-reading-clipping-"));
  fixtures.push(root);
  const html = join(root, "clip.html");
  await writeFile(
    html,
    `<!doctype html><body style="margin:0"><main class="portable-app" style="height:100vh;overflow:auto">
<div style="width:300px;height:100px;overflow:hidden"><div data-block-id="clipped" style="width:300px;height:200px">Clipped</div></div>
<div data-block-id="hidden" style="display:none">Hidden</div><div style="height:1200px">Surroundings</div>
<div data-block-id="target" style="height:100px">Target</div><div style="height:500px">End</div></main></body>`,
  );
  const options = {
    view: "image" as const,
    capture: "viewport" as const,
    viewport: { width: 800, height: 600 },
    inspect: {
      layout: true as const,
      blockIds: ["clipped", "hidden", "target"],
    },
  };
  const initial = await renderReading(html, pageReadSchema.parse(options));
  expect(initial.layout?.blocks[0]).toMatchObject({
    rect: { height: 200 },
    visibleRect: { height: 100 },
    visibleFraction: 0.5,
  });
  expect(initial.layout?.blocks[1]).toMatchObject({ visibleFraction: 0 });
  const scrolled = await renderReading(
    html,
    pageReadSchema.parse({ ...options, scrollToBlockId: "target" }),
  );
  expect(scrolled.layout?.blocks[2]).toMatchObject({
    rect: { y: 0 },
    visibleFraction: 1,
  });
  expect(scrolled.layout?.blocks[0]).toMatchObject({ visibleFraction: 0 });
  expect([scrolled.width, scrolled.height]).toEqual([800, 600]);
  expect(scrolled.dom[0].accessibility).toContain("Surroundings");
  await expect(
    renderReading(
      html,
      pageReadSchema.parse({ ...options, scrollToBlockId: "missing" }),
    ),
  ).rejects.toThrow("scrollToBlockId is not rendered: missing");
}, 20000);

test("layout measures the root reading column after scrolling, excluding its padding", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-reading-column-"));
  fixtures.push(root);
  const html = join(root, "column.html");
  await writeFile(
    html,
    `<!doctype html><body style="margin:0"><main class="portable-app">
<div class="container-page is-root" style="height:100vh;overflow:auto">
<div class="container-page-column" style="box-sizing:border-box;width:600px;margin:auto;padding:20px">
<div class="page-document-flow" data-block-id="first" style="height:1200px">First text flow</div>
<div data-block-id="anchor" style="height:200px">Anchor</div><div style="height:700px">End</div>
</div></div></main></body>`,
  );
  const result = await renderReading(
    html,
    pageReadSchema.parse({
      view: "image",
      capture: "viewport",
      viewport: { width: 800, height: 600 },
      scrollToBlockId: "anchor",
      inspect: { layout: true, blockIds: ["anchor"] },
    }),
  );
  expect(result.layout?.contentArea).toEqual({
    x: 120,
    y: 0,
    width: 560,
    height: 600,
  });
  expect(result.layout?.blocks[0]).toMatchObject({
    rect: { y: 0, width: 560 },
    visibleFraction: 1,
  });
}, 15000);

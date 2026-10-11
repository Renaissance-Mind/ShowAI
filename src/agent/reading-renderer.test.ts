import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageReadSchema } from "./page-reading";
import { renderReading } from "./reading-renderer";

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

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

import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Load the client bundle through its own module-loader seam. */
async function loadClient() {
  let plugin;
  globalThis.window = {
    __ModuleLoader__: {
      load({ factory }) {
        plugin = factory((id) => (id === "react" ? React : require(id)));
      },
    },
  };
  await import("../client.js");
  assert.notEqual(plugin, undefined);
  const registrations = [];
  plugin.apply({
    effect(factory) {
      factory();
    },
    locale: { register: () => () => {} },
    slots: {
      inject(_name, register) {
        register();
      },
      register(spec, component) {
        registrations.push({ spec, component });
        return () => {};
      },
    },
  });
  assert.deepEqual(
    registrations.map((entry) => entry.spec.key),
    ["mcp__showai__page_present", "mcp__showai__render_document"],
  );
  return registrations[0].component;
}

/** Build a settled presentation result block. */
function resultBlock(args, result) {
  return {
    kind: "result",
    callId: "call_test",
    call: { name: "mcp__showai__page_present", argsRaw: JSON.stringify(args) },
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError: false,
  };
}

/** Render one card with the identity translator. */
function render(component, block) {
  return renderToStaticMarkup(
    React.createElement(component, { block, callId: "call_test", openFile: () => {}, t: (key) => key }),
  );
}

test("the client card distinguishes Pages from block selections and keeps the full-file action", async () => {
  const component = await loadClient();
  const delivery = { inline: "/tmp/page.inline.html", html: "/tmp/page.html" };

  const page = render(
    component,
    resultBlock({ projectId: "p", pageId: "g" }, { ok: true, data: { title: "整页", delivery } }),
  );
  assert.match(page, /data-state="ok"/);
  assert.match(page, /row\.page/);
  assert.doesNotMatch(page, /row\.fragment/);
  assert.match(page, /action\.openFile/);
  assert.match(page, /action\.open/);

  const selected = render(
    component,
    resultBlock(
      { projectId: "p", pageId: "g", blockIds: ["b1"] },
      { ok: true, data: { title: "局部", delivery } },
    ),
  );
  assert.match(selected, /row\.fragment/);
  assert.doesNotMatch(selected, /row\.page/);

  const failedBlock = resultBlock(
    { projectId: "p", pageId: "g" },
    { ok: false, error: { message: "保存失败" } },
  );
  failedBlock.isError = true;
  const failed = render(component, failedBlock);
  assert.match(failed, /data-state="error"/);
  assert.match(failed, /保存失败/);

  const running = render(component, {
    callId: "call_test",
    name: "mcp__showai__page_present",
    phase: "start",
    argsRaw: "{}",
  });
  assert.match(running, /data-state="running"/);
  assert.doesNotMatch(running, /action\.openFile/);
});

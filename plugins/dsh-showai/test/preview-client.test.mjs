import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Capture the module-loader factory once; the module body runs only once. */
let clientFactory;

/** Load the client bundle through its own module-loader seam. */
async function clientPlugin() {
  if (clientFactory === undefined) {
    globalThis.window = {
      __ModuleLoader__: {
        load({ factory }) {
          clientFactory = factory;
        },
      },
    };
    await import("../client.js");
  }
  assert.notEqual(clientFactory, undefined);
  return clientFactory((id) => (id === "react" ? React : require(id)));
}

/** Apply the plugin into a slot/context seam and return what it registered. */
async function loadClient({ uiConversation } = {}) {
  const plugin = await clientPlugin();
  const registrations = [];
  plugin.apply({
    effect(factory) {
      factory();
    },
    get(name) {
      if (name === "uiConversation") return uiConversation;
      return undefined;
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
  if (uiConversation !== undefined) {
    assert.deepEqual(
      registrations.map((entry) => entry.spec.name).sort(),
      ["conversation.chat.turnTail", "tool.call.toolview", "tool.call.toolview"],
    );
    return {
      card: registrations.find((entry) => entry.spec.name === "tool.call.toolview").component,
      tail: registrations.find((entry) => entry.spec.name === "conversation.chat.turnTail").component,
    };
  }
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

test("the Turn tail keeps a presented page outside the folded process", async () => {
  const definitions = [];
  const uiConversation = {
    events: {
      register(definition) {
        definitions.push(definition);
        return () => {};
      },
    },
  };
  const { tail } = await loadClient({ uiConversation });
  assert.equal(definitions.length, 1);
  const definition = definitions[0];
  assert.equal(definition.kind, "showai-page");

  let context = { state: definition.start() };
  const feed = (event) => {
    context = { state: definition.update(context, { event }) };
  };
  feed({ type: "turn/start", seq: 1, data: { turn: 7 } });
  feed({
    type: "tool/call",
    seq: 2,
    data: { turn: 7, callId: "call_weather", name: "mcp__showai__page_present" },
  });
  feed({ type: "tool/call", seq: 3, data: { turn: 7, callId: "call_bash", name: "bash" } });
  feed({
    type: "tool/result",
    seq: 4,
    data: {
      turn: 7,
      message: {
        isError: false,
        source: { callId: "call_weather" },
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              data: {
                title: "北京天气 · 2026年10月18日",
                delivery: { inline: "/tmp/page.inline.html" },
              },
            }),
          },
        ],
      },
    },
  });
  feed({
    type: "tool/result",
    seq: 5,
    data: {
      turn: 7,
      message: { isError: false, source: { callId: "call_bash" }, content: [{ type: "text", text: "ok" }] },
    },
  });
  assert.equal(context.state.pages.length, 1);

  const turn = { data: new Map([["showai-page", context.state]]) };
  const markup = renderToStaticMarkup(React.createElement(tail, { turn, seq: 9, t: (key) => key }));
  assert.match(markup, /showai-page-tail/);
  assert.match(markup, /showai-page-preview\/call_weather\.html/);
  assert.match(markup, /北京天气/);
  assert.doesNotMatch(markup, /showai-page-preview\/call_bash/);

  const empty = renderToStaticMarkup(
    React.createElement(tail, { turn: { data: new Map() }, seq: 9, t: (key) => key }),
  );
  assert.equal(empty, "");
});

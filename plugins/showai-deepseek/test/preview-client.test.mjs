import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let clientFactory;

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

const SLOT_KINDS = { "tool.call.toolview": "keyed", "conversation.chat.turnTail": "list" };

function assertHostRegistration(spec, registrations) {
  const kind = SLOT_KINDS[spec.name];
  assert.notEqual(kind, undefined, `unknown slot ${spec.name}`);
  const field = kind === "keyed" ? "key" : "id";
  if (spec[field] === undefined) throw new Error(`${kind} slot "${spec.name}" requires options.${field}`);
  const clash = registrations.find((entry) => entry.spec.name === spec.name && entry.spec[field] === spec[field]);
  if (clash !== undefined) throw new Error(`${kind} slot "${spec.name}" already has ${field} "${spec[field]}"`);
}

async function loadClient({ uiConversation } = {}) {
  const plugin = await clientPlugin();
  const registrations = [];
  plugin.apply({
    effect(factory) {
      factory();
    },
    ...(uiConversation === undefined ? {} : { uiConversation }),
    get(name) {
      if (name === "uiConversation") return uiConversation;
      return undefined;
    },
    locale: { register: () => () => {} },
    slots: {
      inject(name, register) {
        if (name in SLOT_KINDS) register();
      },
      register(spec, component) {
        assertHostRegistration(spec, registrations);
        registrations.push({ spec, component });
        return () => {};
      },
    },
  });
  if (uiConversation !== undefined) {
    assert.deepEqual(
      registrations.map((entry) => entry.spec.name).sort(),
      ["conversation.chat.turnTail", "tool.call.toolview", "tool.call.toolview", "tool.call.toolview", "tool.call.toolview"],
    );
    return {
      card: registrations.find((entry) => entry.spec.name === "tool.call.toolview").component,
      savedCard: registrations.find((entry) => entry.spec.key === "mcp__showai__card_present").component,
      tail: registrations.find((entry) => entry.spec.name === "conversation.chat.turnTail").component,
    };
  }
  assert.deepEqual(
    registrations.map((entry) => entry.spec.key),
    ["mcp__showai__page_present", "mcp__showai__render_document", "mcp__showai__show_component", "mcp__showai__card_present"],
  );
  return registrations[0].component;
}

function resultBlock(args, result) {
  return {
    kind: "result",
    callId: "call_test",
    call: { name: "mcp__showai__page_present", argsRaw: JSON.stringify(args) },
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError: false,
  };
}

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

test("each saved-page card opens its selected original in the sidebar", async () => {
  const { savedCard } = await loadClient({ uiConversation: { events: { register: () => () => {} } } });
  const data = { cards: [
    { projectId: "notes", pageId: "first", title: "First page", breadcrumb: ["Notes", "First page"] },
    { projectId: "notes", pageId: "second", blockId: "chart", title: "Second page", description: "Saved chart" },
  ] };
  const opens = [];
  const props = {
    block: resultBlock({}, { ok: true, data }), t: key => key,
    openInSidebar: (address, title) => opens.push({ address, title }),
  };
  const view = savedCard(props);
  const rendered = renderToStaticMarkup(view);
  assert.match(rendered, /<button[^>]+class="showai-saved-page"[^>]*>[\s\S]*Second page/);
  assert.doesNotMatch(rendered, /<iframe/);
  const buttons = view.type(view.props).props.children;
  buttons[1].props.onClick();
  assert.deepEqual(opens, [{ address: "dsh-resource://showai-page/notes/second?blocks=chart", title: "Second page" }]);
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

  let context = {
    state: definition.start(undefined, { event: { type: "turn/start", seq: 1, data: { turn: 7 } } }),
  };
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
  feed({ type: "tool/call", seq: 6, data: { turn: 7, callId: "report", name: "mcp__other__page_present" } });
  feed({ type: "tool/result", seq: 7, data: { turn: 7, message: {
    source: { callId: "report" }, content: [{ type: "text", text: JSON.stringify({
      ok: true, data: { title: "Other report", delivery: { inline: "/tmp/other-report.html" } },
    }) }],
  } } });
  assert.equal(context.state.pages.length, 1);

  const published = definition.buildLocationData({ kind: definition.kind, state: context.state }, "turn");
  assert.equal(published.kind, "turn");
  assert.equal(published.turn, 7);
  assert.equal(published.key, "showai-page");
  assert.equal(published.value.pages.length, 1);
  assert.equal(definition.buildLocationData({ kind: definition.kind, state: context.state }, "step"), null);
  assert.equal(
    definition.buildLocationData({ kind: definition.kind, state: context.state }, "turn", published),
    published,
  );

  assert.equal(context.state.pages[0].fullPath, "/tmp/page.inline.html");
  const turn = { data: new Map([["showai-page", { pages: context.state.pages }]]) };
  const markup = renderToStaticMarkup(
    React.createElement(tail, { turn, seq: 9, openFile: () => {}, t: (key) => key }),
  );
  assert.match(markup, /action\.openFile/);
  assert.match(markup, /action\.hide/);
  assert.match(markup, /showai-page-tail/);
  assert.match(markup, /showai-page-preview\/call_weather\.html/);
  assert.match(markup, /北京天气/);
  assert.doesNotMatch(markup, /showai-page-preview\/call_bash/);

  assert.equal(renderToStaticMarkup(React.createElement(tail, { turn, seq: 4, t: (key) => key })), "");

  const special = { ...context.state.pages[0], callId: "step:1" };
  const specialTurn = { data: new Map([["showai-page", { pages: [special] }]]) };
  const specialCard = renderToStaticMarkup(React.createElement(tail, { turn: specialTurn, seq: 9, t: (key) => key }));
  assert.match(specialCard, /by-id\?callId=step%3A1&amp;v=0/);

  const empty = renderToStaticMarkup(
    React.createElement(tail, { turn: { data: new Map() }, seq: 9, t: (key) => key }),
  );
  assert.equal(empty, "");
});

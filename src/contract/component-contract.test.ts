import { expect, test } from "vitest";
import {
  componentObjects,
  validateComponentContract,
  validateComponentContractData,
  componentContract,
  type ComponentContract,
} from "./component-contract.mjs";
import { builtinContracts } from "./builtin-contracts.mjs";
import { createComponentRuntime } from "./component-runtime.mjs";
import { componentHostRequest, contractPayloadIssue } from "./component-host";
import { assignSurfaceIds, remapSurfaceIds } from "../document/document.mjs";
import { createResource } from "../document/containers.mjs";
import { blankDocument } from "../core/catalog";
import { widgetDocuments } from "../document/walk.mjs";

const contract: ComponentContract = {
  version: 1,
  entities: [
    {
      name: "experiment",
      path: "/groups/*/items/*",
      id: "/id",
      scope: "/groups/*/id",
    },
  ],
  events: [
    {
      name: "inspect",
      entity: "experiment",
      intent: "request",
      payload: { type: "null" },
    },
  ],
  actions: [
    {
      name: "select",
      effect: "view",
      input: { type: "string" },
      output: { type: "string" },
    },
  ],
  slots: [{ name: "details", path: "/groups/*/body", format: "richtext" }],
  references: [
    { path: "/groups/*/selected", slot: "details", scope: "/groups/*" },
  ],
};
const data = () => ({
  groups: ["a", "b"].map((id) => ({
    id,
    items: [{ id: "same" }],
    selected: "same",
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "same" },
          content: [{ type: "text", text: id }],
        },
      ],
    },
  })),
});
test("object discovery retains scope and accepts a component-specific event", () => {
  expect(validateComponentContract(contract)).toBe(contract);
  expect(componentObjects(contract, data())).toEqual([
    { type: "experiment", scope: "a", id: "same" },
    { type: "experiment", scope: "b", id: "same" },
  ]);
  expect(() => validateComponentContract({ version: 2 })).toThrow(/version/);
  expect(() =>
    validateComponentContract({ version: 1, requires: { imaginary: 1 } }),
  ).toThrow(/capability/);
  expect(() =>
    validateComponentContract({
      ...contract,
      events: [{ name: "x", entity: "missing", intent: "request" }],
    }),
  ).toThrow(/entity/);
  expect(() =>
    validateComponentContract({
      ...contract,
      slots: [{ name: "bad", path: "/__proto__/x", format: "richtext" }],
    }),
  ).toThrow(/unsafe/);
  const invalid = data();
  invalid.groups[0].selected = "gone";
  expect(() => validateComponentContractData(contract, invalid)).toThrow(
    /missing/,
  );
});
test("declared slots isolate business JSON and remap references without mutating source", () => {
  const props = {
    ...data(),
    businessJson: {
      type: "doc",
      content: [{ type: "paragraph", attrs: { id: "opaque" } }],
    },
  };
  expect(widgetDocuments(props, contract)).toHaveLength(2);
  expect(widgetDocuments(props)).toHaveLength(3);
  const page = createResource(blankDocument());
  page.content.content = [
    {
      type: "widget",
      attrs: {
        id: "custom",
        kind: "custom",
        data: { componentId: "declared", version: "1.0.0", props, contract },
      },
    },
  ];
  const original = JSON.stringify(page);
  const normalized = assignSurfaceIds(structuredClone(page));
  for (const copy of [normalized, remapSurfaceIds(normalized)]) {
    const output = copy.content.content![0].attrs!.data.props;
    expect(() => validateComponentContractData(contract, output)).not.toThrow();
    expect(output.groups[0].selected).not.toBe(output.groups[1].selected);
    expect(output.businessJson).toEqual(props.businessJson);
  }
  expect(JSON.stringify(page)).toBe(original);
});
test("references resolve only the active slot when legacy content is retained", () => {
  const definition: ComponentContract = {
    version: 1,
    slots: [
      { name: "body", path: "/document", format: "richtext" },
      {
        name: "legacy",
        path: "/content",
        format: "richtext",
        fallbackFor: "body",
      },
    ],
    references: [{ path: "/selected", slot: "legacy" }],
  };
  const content = {
    type: "doc",
    content: [{ type: "paragraph", attrs: { id: "old" } }],
  };
  expect(() =>
    validateComponentContractData(definition, { content, selected: "old" }),
  ).not.toThrow();
  expect(() =>
    validateComponentContractData(definition, {
      content,
      document: {
        type: "doc",
        content: [{ type: "paragraph", attrs: { id: "new" } }],
      },
      selected: "old",
    }),
  ).toThrow(/missing/);
});
test("runtime requests use acknowledged receipts and enforce declared targets and read-only actions", async () => {
  let selected = "",
    calls = 0;
  const runtime = createComponentRuntime({
    contract,
    validate: (kind, name, value) =>
      contractPayloadIssue(contract, kind, name, value),
    state: () => ({ data: data(), readOnly: true }),
    request: async (operation, input) => {
      calls++;
      return componentHostRequest({
        contract,
        data: data(),
        operation,
        input,
        services: { "event.emit": () => ({ status: "unhandled" }) },
      });
    },
  });
  expect(
    await runtime.events.emit("inspect", {
      type: "experiment",
      scope: "b",
      id: "same",
    }),
  ).toEqual({ status: "unhandled" });
  await expect(
    runtime.events.emit("inspect", {
      type: "experiment",
      scope: "b",
      id: "missing",
    }),
  ).rejects.toThrow(/existing/);
  expect(await runtime.update({})).toMatchObject({ status: "unavailable" });
  const dispose = runtime.actions.register("select", (value) => {
    selected = value;
    return selected;
  });
  expect(await runtime.actions.invoke("select", "b")).toEqual({
    status: "handled",
    value: "b",
  });
  expect(calls).toBe(1);
  dispose();
  expect(await runtime.actions.invoke("select", "a")).toMatchObject({
    status: "unavailable",
  });
  expect(componentContract({})).toMatchObject({ legacy: true });
  for (const definition of Object.values(builtinContracts))
    expect(() => validateComponentContract(definition)).not.toThrow();
});
test("view state is schema checked and content actions respect host data availability", async () => {
  const definition: ComponentContract = {
    version: 1,
    requires: { data: 1, actions: 1, content: 1, references: 1 },
    actions: [{ name: "edit", effect: "content" }],
    view: { version: 1, schema: { type: "string" } },
  };
  let view: unknown;
  const runtime = createComponentRuntime({
    contract: definition,
    state: () => ({
      data: {},
      readOnly: false,
      dataState: { status: "ok", editable: false },
      view,
    }),
    validate: (kind, name, value) =>
      contractPayloadIssue(definition, kind, name, value),
    request: (operation, input) =>
      componentHostRequest({
        contract: definition,
        data: {},
        operation,
        input,
        services: {
          "view.set": (value) => {
            view = value;
            return { status: "handled" };
          },
        },
      }),
  });
  runtime.actions.register("edit", () => {
    throw new Error("must not run");
  });
  expect(await runtime.actions.invoke("edit")).toMatchObject({
    status: "unavailable",
  });
  expect(await runtime.view.set("selected")).toEqual({ status: "handled" });
  expect(runtime.view.value).toBe("selected");
  await expect(runtime.view.set(12)).rejects.toThrow();
  expect(runtime.view.value).toBe("selected");
  expect(() =>
    createComponentRuntime({
      contract: { version: 1, requires: { pageOutline: 1 } },
      state: () => ({ data: {} }),
      capabilities: () => ({ pageOutline: 0 }),
    }),
  ).toThrow(/unavailable/);
});

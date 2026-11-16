import {
  COMPONENT_PROTOCOL,
  componentObjects,
  validateComponentContract,
} from "./component-contract.mjs";
import { componentViewStateIssue } from "./component-context.mjs";
import { componentDataState } from "../lib/component-editability.mjs";

export function createComponentRuntime(options) {
  const capabilities = () => ({
    data: 1,
    actions: 1,
    content: 1,
    references: 1,
    ...options.capabilities?.(),
  });
  const contract = validateComponentContract(
    structuredClone(options.contract ?? { version: 1 }),
  );
  const freeze = (value) => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(contract);
  const schemas = [
    ...(contract.events ?? []).map((event) => event.payload),
    ...(contract.actions ?? []).flatMap((action) => [
      action.input,
      action.output,
    ]),
    contract.view?.schema,
  ];
  if (
    schemas.some((schema) => schema !== undefined && schema !== true) &&
    !options.validate
  )
    throw new Error("Declared component schemas need a payload validator");
  for (const [name, version] of Object.entries(contract.requires ?? {}))
    if (capabilities()[name] !== version)
      throw new Error(
        "Required component host capability unavailable: " + name,
      );
  const handlers = new Map();
  const state = () => options.state();
  const check = (kind, name, value) => {
    const jsonIssue = componentViewStateIssue(value, {
      bytes: kind === "view" ? 16384 : 65536,
      depth: 20,
    });
    if (jsonIssue) throw new Error(`${kind}.${name}: ${jsonIssue}`);
    const issue = options.validate?.(kind, name, value);
    if (issue) throw new Error(`${kind}.${name}: ${issue}`);
  };
  const result = (value) => {
    if (
      !value ||
      !["handled", "unhandled", "unavailable", "failed"].includes(value.status)
    )
      throw new Error("Invalid component operation receipt");
    return value;
  };
  const request = async (operation, input) => {
    if (!options.request)
      return {
        status: "unavailable",
        reason: "This host does not provide component operations.",
      };
    try {
      return result(await options.request(operation, input));
    } catch (error) {
      return { status: "failed", reason: String(error?.message ?? error) };
    }
  };
  const runtime = {
    protocol: COMPONENT_PROTOCOL,
    contract,
    get capabilities() {
      return capabilities();
    },
    get data() {
      return state().data;
    },
    get slot() {
      return state().slot ?? { kind: "block" };
    },
    get readOnly() {
      return state().readOnly !== false;
    },
    get dataState() {
      return componentDataState(state().dataState, runtime.readOnly);
    },
    objects: () => componentObjects(contract, state().data),
    update: async (data) => {
      if (runtime.readOnly || runtime.dataState.editable === false)
        return { status: "unavailable", reason: "Content is read-only." };
      return request("data.update", data);
    },
    events: {
      async emit(name, target = null, payload = null) {
        const event = contract.events?.find((event) => event.name === name);
        if (!event) throw new Error("Undeclared component event: " + name);
        check("event", name, payload);
        if (event.entity) {
          if (
            target &&
            Object.keys(target).some(
              (key) => !["type", "scope", "id"].includes(key),
            )
          )
            throw new Error("Object identities accept only type, scope and id");
          if (
            !target ||
            target.type !== event.entity ||
            !runtime
              .objects()
              .some(
                (object) =>
                  object.type === target.type &&
                  object.scope === target.scope &&
                  object.id === target.id,
              )
          )
            throw new Error(
              "Event target does not identify an existing declared object",
            );
        } else if (target !== null)
          throw new Error("This event does not declare an object target");
        return request("event.emit", {
          name,
          target,
          payload,
          intent: event.intent,
        });
      },
    },
    actions: {
      register(name, handler) {
        if (!contract.actions?.some((action) => action.name === name))
          throw new Error("Undeclared component action: " + name);
        if (typeof handler !== "function" || handlers.has(name))
          throw new Error(
            "Action handler is missing or already registered: " + name,
          );
        handlers.set(name, handler);
        return () => {
          if (handlers.get(name) === handler) handlers.delete(name);
        };
      },
      async invoke(name, input = null) {
        const action = contract.actions?.find((action) => action.name === name);
        if (!action) throw new Error("Undeclared component action: " + name);
        check("input", name, input);
        if (
          action.effect === "content" &&
          (runtime.readOnly || runtime.dataState.editable === false)
        )
          return { status: "unavailable", reason: "Content is read-only." };
        const handler = handlers.get(name);
        if (!handler)
          return {
            status: "unavailable",
            reason: "Action is not mounted: " + name,
          };
        let output;
        try {
          output = await handler(input);
        } catch (error) {
          return { status: "failed", reason: String(error?.message ?? error) };
        }
        const value = output === undefined ? null : output;
        check("output", name, value);
        return { status: "handled", value };
      },
    },
    view: {
      get value() {
        return state().view;
      },
      async set(value) {
        if (!contract.view)
          throw new Error("This component does not declare reading state");
        if (value !== undefined) check("view", "state", value);
        return request("view.set", value);
      },
    },
    navigation: { open: (target) => request("navigation.open", target) },
    conversation: {
      submit: (snapshot) => request("conversation.submit", snapshot),
    },
    field: {
      set: (value) => request("field.set", value),
      close: () => request("field.close", null),
    },
    outline: {
      navigate: (id) => request("outline.navigate", id),
      expand: (id, expanded) => request("outline.expand", { id, expanded }),
      collapse: () => request("outline.collapse", null),
    },
    dispose() {
      handlers.clear();
    },
  };
  return runtime;
}

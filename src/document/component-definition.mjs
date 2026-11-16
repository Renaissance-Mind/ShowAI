export const COMPONENT_PROTOCOL = "showai-component-v1";
export const COMPONENT_CAPABILITIES = Object.freeze({
  data: 1,
  events: 1,
  actions: 1,
  content: 1,
  references: 1,
  view: 1,
  navigation: 1,
  conversation: 1,
  resources: 1,
  pageReferences: 1,
  pageOutline: 1,
  databaseField: 1,
  mention: 1,
  commands: 1,
  reading: 1,
});
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
const nameSchema = { type: "string", minLength: 1, maxLength: 200 };
const pathSchema = { type: "string", maxLength: 500, pattern: "^(|/.*)$" };
const jsonSchema = { anyOf: [{ type: "boolean" }, { type: "object" }] };
const declarations = {
  entities: {
    required: ["name", "path", "id"],
    properties: {
      name: nameSchema,
      path: pathSchema,
      id: pathSchema,
      scope: pathSchema,
      scopeValue: nameSchema,
      optional: { type: "boolean" },
    },
  },
  events: {
    required: ["name", "intent"],
    properties: {
      name: nameSchema,
      entity: nameSchema,
      intent: { enum: ["notification", "request"] },
      payload: jsonSchema,
    },
  },
  actions: {
    required: ["name", "effect"],
    properties: {
      name: nameSchema,
      effect: { enum: ["view", "content"] },
      input: jsonSchema,
      output: jsonSchema,
    },
  },
  slots: {
    required: ["name", "path", "format"],
    properties: {
      name: nameSchema,
      path: pathSchema,
      format: { const: "richtext" },
      accepts: { type: "array", maxItems: 100, items: nameSchema },
      fallbackFor: nameSchema,
    },
  },
  references: {
    required: ["path", "slot"],
    properties: { path: pathSchema, slot: nameSchema, scope: pathSchema },
  },
};
export const COMPONENT_CONTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version"],
  properties: {
    version: { const: 1 },
    requires: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        Object.entries(COMPONENT_CAPABILITIES).map(([key, value]) => [
          key,
          { const: value },
        ]),
      ),
    },
    ...Object.fromEntries(
      Object.entries(declarations).map(([key, entry]) => [
        key,
        {
          type: "array",
          maxItems: 100,
          items: { type: "object", additionalProperties: false, ...entry },
        },
      ]),
    ),
    view: {
      type: "object",
      additionalProperties: false,
      required: ["version", "schema"],
      properties: {
        version: { type: "integer", minimum: 1 },
        schema: jsonSchema,
      },
    },
  },
};
const fail = (path, message) => {
  throw new Error(`contract${path}: ${message}`);
};
const record = (value, path, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(path, "must be an object");
  for (const key of Object.keys(value))
    if (forbidden.has(key) || (keys && !keys.includes(key)))
      fail(`${path}.${key}`, "unknown field");
};
const text = (value, path) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Array.from(value).length > 200
  )
    fail(path, "must be non-empty text up to 200 characters");
};
export function contractPath(value) {
  if (value === "") return [];
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.length > 500 ||
    /~(?![01])/.test(value)
  )
    fail(".path", "use a JSON pointer with optional * segments");
  const parts = value
    .slice(1)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (parts.some((p) => !p || forbidden.has(p)))
    fail(".path", "unsafe path segment");
  return parts;
}
export function contractValues(data, pointer, context = []) {
  const parts = contractPath(pointer),
    result = [];
  const step = (value, at, path) => {
    if (at === parts.length) {
      result.push({ value, path });
      return;
    }
    if (!value || typeof value !== "object") return;
    const key = parts[at];
    if (key === "*") {
      const bound = context[at];
      if (bound !== undefined) {
        if (Object.hasOwn(value, bound))
          step(value[bound], at + 1, [...path, bound]);
      } else
        for (const item of Object.keys(value))
          if (!forbidden.has(item)) step(value[item], at + 1, [...path, item]);
    } else if (Object.hasOwn(value, key))
      step(value[key], at + 1, [...path, key]);
  };
  step(data, 0, []);
  return result;
}
export function componentSlotValues(contract, data, slot) {
  const entries = contractValues(data, slot.path).filter(
    (entry) => entry.value != null && entry.value !== "",
  );
  if (!slot.fallbackFor) return entries;
  const primary = contract.slots.find(
    (entry) => entry.name === slot.fallbackFor,
  );
  return entries.filter(
    (entry) =>
      !contractValues(data, primary.path, entry.path).some(
        (value) => value.value != null && value.value !== "",
      ),
  );
}
export function validateComponentContract(value) {
  record(value, "", Object.keys(COMPONENT_CONTRACT_SCHEMA.properties));
  if (value.version !== 1) fail(".version", "unsupported protocol version");
  for (const [key, declaration] of Object.entries(declarations)) {
    const list = value[key] ?? [];
    if (!Array.isArray(list) || list.length > 100)
      fail(`.${key}`, "must be an array of at most 100 entries");
    const names = new Set();
    for (const [index, entry] of list.entries()) {
      const at = `.${key}[${index}]`;
      record(entry, at, Object.keys(declaration.properties));
      for (const key of declaration.required)
        if (!Object.hasOwn(entry, key)) fail(at + "." + key, "is required");
      if (key !== "references") {
        text(entry.name, at + ".name");
        if (names.has(entry.name)) fail(at + ".name", "duplicate name");
        names.add(entry.name);
      }
      if (["entities", "slots", "references"].includes(key))
        contractPath(entry.path);
      if (key === "entities") {
        if (contractPath(entry.id).includes("*"))
          fail(at + ".id", "must identify one scalar field per object");
        if (entry.scope !== undefined) {
          const scope = contractPath(entry.scope),
            source = contractPath(entry.path);
          const wildcard = scope.lastIndexOf("*");
          if (
            wildcard >= 0 &&
            scope
              .slice(0, wildcard + 1)
              .some((part, index) => part !== source[index])
          )
            fail(
              at + ".scope",
              "wildcards must share the entity source prefix",
            );
        }
        if (entry.scopeValue !== undefined)
          text(entry.scopeValue, at + ".scopeValue");
        if ((entry.scope === undefined) === (entry.scopeValue === undefined))
          fail(at, "provide exactly one of scope or scopeValue");
        if (entry.optional !== undefined && typeof entry.optional !== "boolean")
          fail(at + ".optional", "must be boolean");
      }
      if (key === "events") {
        if (entry.entity !== undefined) text(entry.entity, at + ".entity");
        if (!["notification", "request"].includes(entry.intent))
          fail(at + ".intent", "must be notification or request");
      }
      if (key === "actions" && !["view", "content"].includes(entry.effect))
        fail(at + ".effect", "must be view or content");
      for (const schema of ["payload", "input", "output"])
        if (entry[schema] !== undefined && typeof entry[schema] !== "boolean")
          record(entry[schema], at + "." + schema);
      if (key === "slots" && entry.format !== "richtext")
        fail(at + ".format", "must be richtext");
      if (
        key === "slots" &&
        entry.accepts !== undefined &&
        (!Array.isArray(entry.accepts) ||
          entry.accepts.length > 100 ||
          entry.accepts.some(
            (kind) =>
              typeof kind !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(kind),
          ))
      )
        fail(at + ".accepts", "must list component kinds");
      if (key === "references") {
        text(entry.slot, at + ".slot");
        contractPath(entry.scope ?? "");
      }
    }
  }
  const entities = new Set((value.entities ?? []).map((e) => e.name));
  for (const event of value.events ?? [])
    if (event.entity && !entities.has(event.entity))
      fail(".events", "unknown entity: " + event.entity);
  const slots = new Set((value.slots ?? []).map((s) => s.name));
  for (const slot of value.slots ?? [])
    if (slot.fallbackFor) {
      const primary = value.slots.find(
        (entry) => entry.name === slot.fallbackFor,
      );
      if (!primary || primary === slot || primary.fallbackFor)
        fail(".slots", "fallback must name a primary slot");
      const target = contractPath(primary.path),
        source = contractPath(slot.path),
        wildcard = target.lastIndexOf("*");
      if (
        wildcard >= 0 &&
        target
          .slice(0, wildcard + 1)
          .some((part, index) => part !== source[index])
      )
        fail(".slots", "fallback wildcard scope must match the primary slot");
    }
  const referencePaths = new Set();
  for (const ref of value.references ?? []) {
    if (!slots.has(ref.slot))
      fail(".references", "unknown content slot: " + ref.slot);
    if (referencePaths.has(ref.path))
      fail(".references", "duplicate reference path");
    referencePaths.add(ref.path);
    const scope = contractPath(ref.scope ?? ""),
      path = contractPath(ref.path);
    const slot = contractPath(
      value.slots.find((slot) => slot.name === ref.slot).path,
    );
    if (
      scope.some((part, index) => part !== path[index] || part !== slot[index])
    )
      fail(
        ".references",
        "scope must be a shared prefix of the reference and slot paths",
      );
  }
  if (value.requires !== undefined) {
    record(value.requires, ".requires");
    for (const [name, version] of Object.entries(value.requires))
      if (
        !Object.hasOwn(COMPONENT_CAPABILITIES, name) ||
        version !== COMPONENT_CAPABILITIES[name]
      )
        fail(".requires." + name, "unsupported required capability/version");
  }
  if (value.view !== undefined) {
    record(value.view, ".view", ["version", "schema"]);
    if (!Number.isInteger(value.view.version) || value.view.version < 1)
      fail(".view.version", "must be a positive integer");
    if (typeof value.view.schema !== "boolean")
      record(value.view.schema, ".view.schema");
  }
  return value;
}
export function componentObjects(contract, data) {
  const objects = [],
    identities = new Set();
  for (const entity of contract.entities ?? [])
    for (const entry of contractValues(data, entity.path)) {
      const id = contractValues(entry.value, entity.id)[0]?.value;
      if (id === undefined && entity.optional) continue;
      const scope =
        entity.scopeValue ??
        contractValues(data, entity.scope, entry.path)[0]?.value;
      if (
        typeof id !== "string" ||
        !id.trim() ||
        typeof scope !== "string" ||
        !scope.trim()
      )
        fail(
          ".entities." + entity.name,
          "object identity is missing at /" + entry.path.join("/"),
        );
      text(id, ".entities.id");
      text(scope, ".entities.scope");
      const object = { type: entity.name, scope, id },
        key = JSON.stringify(object);
      if (identities.has(key))
        fail(".entities." + entity.name, "duplicate object identity " + key);
      identities.add(key);
      objects.push(object);
      if (objects.length > 50000)
        fail(".entities", "component exceeds 50000 addressable objects");
    }
  return objects;
}
export function validateComponentContractData(contract, data) {
  validateComponentContract(contract);
  record(data, ".data");
  componentObjects(contract, data);
  for (const slot of contract.slots ?? [])
    for (const { value } of componentSlotValues(contract, data, slot)) {
      if (typeof value === "string") continue;
      if (!value || value.type !== "doc" || !Array.isArray(value.content))
        fail(".slots." + slot.name, "must contain a richtext document");
      if (slot.accepts) {
        const visit = (node) => {
          if (
            ["widget", "inlineWidget"].includes(node.type) &&
            !slot.accepts.includes(node.attrs?.kind)
          )
            fail(
              ".slots." + slot.name,
              "component kind is not declared in accepts: " + node.attrs?.kind,
            );
          for (const child of node.content ?? []) visit(child);
        };
        visit(value);
      }
    }
  for (const ref of contract.references ?? []) {
    const slot = contract.slots.find((slot) => slot.name === ref.slot);
    for (const entry of contractValues(data, ref.path)) {
      const scope = contractPath(ref.scope ?? "");
      const found = new Map();
      const location = entry.path.slice(0, scope.length);
      for (const { value } of componentSlotValues(contract, data, slot).filter(
        (value) => location.every((part, index) => value.path[index] === part),
      )) {
        const visit = (node) => {
          if (node.attrs?.id)
            found.set(node.attrs.id, (found.get(node.attrs.id) ?? 0) + 1);
          for (const child of node.content ?? []) visit(child);
        };
        if (value?.type === "doc") visit(value);
      }
      if (typeof entry.value !== "string" || !found.has(entry.value))
        fail(
          ".references",
          "missing content object at /" + entry.path.join("/"),
        );
      if (found.get(entry.value) !== 1)
        fail(
          ".references",
          "ambiguous content object; declare a narrower scope",
        );
    }
  }
  return data;
}
export function componentContract(metadata) {
  const declared = metadata.contract;
  let contract = declared
    ? validateComponentContract(declared)
    : { version: 1 };
  if (metadata.insertion)
    contract = {
      ...contract,
      entities: [
        ...(contract.entities ?? []),
        {
          name: "block",
          path: "/content/*",
          id: "/attrs/id",
          scopeValue: "children",
          optional: true,
        },
      ],
    };
  const capabilities = { data: 1, navigation: 1, resources: 1 };
  if (contract.events?.length) capabilities.events = 1;
  if (contract.actions?.length) capabilities.actions = 1;
  if (contract.slots?.length) capabilities.content = 1;
  if (metadata.insertion) capabilities.content = 1;
  if (contract.references?.length) capabilities.references = 1;
  if (contract.view) capabilities.view = 1;
  if (metadata.role === "page-outline")
    capabilities.pageOutline = metadata.pageOutlineProtocol;
  if (metadata.reader) capabilities.reading = 1;
  if (metadata.pageReferences) capabilities.pageReferences = 1;
  for (const name of ["databaseField", "mention", "commands"])
    if (metadata.contributes?.[name]) capabilities[name] = 1;
  return {
    protocol: COMPONENT_PROTOCOL,
    status: metadata.insertion ? "adapted" : declared ? "declared" : "legacy",
    contract,
    capabilities,
    legacy: !declared,
    execution: {
      mode: metadata.kind ? "native" : "package",
      inlineProtocol: metadata.inline?.protocol ?? "legacy",
    },
  };
}

/** Portable schema/semantics contract, shared by authoring, readers and compiled sandboxes. */
export const COMPONENT_PARAMETER_PROTOCOL = "showai-component-parameters-v1";
export const COMPONENT_PARAMETER_CAPABILITIES = Object.freeze({
  protocol: COMPONENT_PARAMETER_PROTOCOL,
  documentationVersions: [1, 2],
  authoringVersion: 2,
  view: "parameters",
  fieldSelection: "parameterPath",
  pagination: true,
  knownHash: true,
  relations: ["unique", "reference", "index", "sumMaximum"],
  defaultPolicy: "annotation-only",
  formatPolicy: "annotation-only",
});
const unsafe = new Set(["__proto__", "prototype", "constructor"]);
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const escape = (x) => x.replace(/~/g, "~0").replace(/\//g, "~1");
export function parameterPath(value) {
  if (typeof value !== "string" || !value || value.length > 500)
    throw new Error("Parameter path must contain 1–500 characters.");
  let parts;
  if (value.startsWith("/")) {
    if (/~(?![01])/.test(value))
      throw new Error("Invalid parameter pointer escape.");
    parts = value
      .slice(1)
      .split("/")
      .map((x) => x.replace(/~1/g, "/").replace(/~0/g, "~"));
  } else {
    if (
      !/^[A-Za-z_$][A-Za-z0-9_$-]*(?:\[\])?(?:\.[A-Za-z_$][A-Za-z0-9_$-]*(?:\[\])?)*$/.test(
        value,
      )
    )
      throw new Error(
        "Use a JSON pointer or dotted fields with [] array wildcards.",
      );
    parts = value.replace(/\[\]/g, ".*").split(".");
  }
  if (parts.some((x) => !x || unsafe.has(x)))
    throw new Error("Unsafe or empty parameter path segment.");
  return "/" + parts.map(escape).join("/");
}
function resolved(root, node) {
  if (!object(node)) return node;
  if (!node.$ref) return node;
  if (node.$ref === "#") return root;
  if (typeof node.$ref !== "string" || !node.$ref.startsWith("#/"))
    throw new Error(
      "Parameter contracts support package-local schema references only.",
    );
  let target = root;
  for (const part of node.$ref.slice(2).split("/"))
    target = target?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  if (!object(target) && typeof target !== "boolean")
    throw new Error("Unresolved parameter schema reference: " + node.$ref);
  return target;
}
export function schemaParameters(schema) {
  const fields = new Map();
  function visit(
    raw,
    path,
    required = "optional",
    conditional = false,
    stack = new Set(),
    depth = 0,
  ) {
    if (depth > 30 || fields.size > 2000)
      throw new Error(
        "Parameter schema is too deep or large; use documented opaque values for external data formats.",
      );
    const node = resolved(schema, raw);
    if (path) {
      const previous = fields.get(path);
      const requirement = conditional ? "conditional" : required;
      if (previous) {
        previous.schemas.push(node);
        if (requirement === "required") previous.required = "required";
        else if (
          previous.required !== "required" &&
          requirement === "conditional"
        )
          previous.required = "conditional";
      } else fields.set(path, { path, required: requirement, schemas: [node] });
    }
    if (!object(node) || stack.has(node)) return;
    const next = new Set(stack);
    next.add(node);
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      if (unsafe.has(key) || key === "*")
        throw new Error("Reserved parameter schema property: " + key);
      visit(
        child,
        path + "/" + escape(key),
        (node.required ?? []).includes(key) ? "required" : "optional",
        conditional,
        next,
        depth + 1,
      );
    }
    if (object(node.items) || typeof node.items === "boolean")
      visit(node.items, path + "/*", "required", conditional, next, depth + 1);
    if (Array.isArray(node.items))
      node.items.forEach((item, index) =>
        visit(
          item,
          path + "/" + index,
          "required",
          conditional,
          next,
          depth + 1,
        ),
      );
    for (const key of ["allOf", "oneOf", "anyOf"])
      for (const branch of node[key] ?? [])
        visit(
          branch,
          path,
          required,
          conditional || key !== "allOf",
          next,
          depth + 1,
        );
    for (const key of ["then", "else"])
      if (node[key]) visit(node[key], path, required, true, next, depth + 1);
  }
  visit(schema, "");
  return [...fields.values()];
}
function inputMap(documentation) {
  const result = new Map();
  result.diagnostics = [];
  for (const input of documentation?.usage?.inputs ?? []) {
    let path;
    try {
      path = parameterPath(input.path);
    } catch (error) {
      result.diagnostics.push({
        path: input.path,
        code: "invalid-explanation-path",
        message: error.message,
      });
      continue;
    }
    if (result.has(path)) {
      result.diagnostics.push({
        path,
        code: "duplicate-explanation",
        message: "Parameter explanation is duplicated.",
      });
      continue;
    }
    result.set(path, { ...input, path });
  }
  return result;
}
function semantic(field, inputs) {
  let own = inputs.get(field.path);
  if (!own && field.path.endsWith("/*") && inputs.has(field.path.slice(0, -2)))
    own = { ...inputs.get(field.path.slice(0, -2)), omission: undefined };
  if (!own) {
    const description = field.schemas.find(
      (x) => object(x) && typeof x.description === "string",
    )?.description;
    if (description) own = { path: field.path, meaning: description };
  }
  if (!own) return undefined;
  const ancestors = [...inputs.values()]
    .filter(
      (input) =>
        field.path.startsWith(input.path + "/") &&
        (input.units || input.coordinateSystem),
    )
    .sort((a, b) => b.path.length - a.path.length);
  const context = ancestors[0];
  return {
    ...(context
      ? {
          units: context.units,
          coordinateSystem: context.coordinateSystem,
          context: { path: context.path, meaning: context.meaning },
        }
      : {}),
    ...own,
  };
}
export function parameterContractIssues(schema, documentation) {
  const fields = schemaParameters(schema),
    paths = new Set(fields.map((x) => x.path)),
    inputs = inputMap(documentation),
    issues = [...inputs.diagnostics];
  if (
    !fields.length &&
    (!object(schema) ||
      schema.type !== "object" ||
      schema.additionalProperties !== false)
  )
    issues.push({
      path: "",
      code: "unbounded-root",
      message:
        "A component without named parameters needs a closed object schema; wrap external data in an explicitly documented opaque parameter.",
    });
  for (const [path, input] of inputs) {
    if (!paths.has(path))
      issues.push({
        path,
        code: "unknown-path",
        message: "Explanation does not resolve to a schema parameter.",
      });
    if (
      input.omission?.behavior === "fallback" &&
      !Object.hasOwn(input.omission, "value") &&
      !input.omission.from &&
      !input.omission.computedFrom
    )
      issues.push({
        path,
        code: "missing-fallback",
        message:
          "Fallback behavior needs a JSON value, a first/last source, or declared computedFrom inputs.",
      });
  }
  for (const [path, input] of inputs) {
    const omission = input.omission;
    if (!omission) continue;
    if (
      omission.behavior !== "fallback" &&
      (Object.hasOwn(omission, "value") ||
        omission.from ||
        omission.computedFrom)
    )
      issues.push({
        path,
        code: "unexpected-fallback",
        message: "Only fallback behavior may declare a value/source.",
      });
    if (
      Number(Object.hasOwn(omission, "value")) +
        Number(!!omission.from) +
        Number(!!omission.computedFrom) >
      1
    )
      issues.push({
        path,
        code: "ambiguous-fallback",
        message: "Declare one fallback value, source or derived-input list.",
      });
    for (const source of omission.computedFrom ?? [])
      if (!paths.has(parameterPath(source)))
        issues.push({
          path,
          code: "unknown-fallback-source",
          message: "Computed fallback input is not a schema parameter.",
        });
    if (omission.from && !paths.has(parameterPath(omission.from.path)))
      issues.push({
        path,
        code: "unknown-fallback-source",
        message: "Fallback source is not a schema parameter.",
      });
  }
  for (const field of fields) {
    const input = semantic(field, inputs);
    if (!input?.meaning)
      issues.push({
        path: field.path,
        code: "missing-meaning",
        message: "Parameter has no semantic explanation.",
      });
    if (field.required !== "required" && !input?.omission)
      issues.push({
        path: field.path,
        code: "missing-omission",
        message:
          "Optional/conditional parameter needs an explicit omission behavior.",
      });
    if (field.required === "optional" && input?.omission?.behavior === "reject")
      issues.push({
        path: field.path,
        code: "optional-reject",
        message:
          "Rejected omission must be represented by schema required/conditional constraints.",
      });
    if (
      field.required === "required" &&
      input?.omission &&
      input.omission.behavior !== "reject"
    )
      issues.push({
        path: field.path,
        code: "required-omission",
        message:
          "A schema-required parameter cannot promise omission or fallback.",
      });
    const opaque = field.schemas.some(
      (x) =>
        x === true ||
        (object(x) &&
          !x.$ref &&
          !x.properties &&
          !x.items &&
          !x.enum &&
          !x.const &&
          !x.oneOf &&
          !x.anyOf &&
          (x.type === undefined || x.type === "object")),
    );
    if (opaque && !input?.opaque)
      issues.push({
        path: field.path,
        code: "unbounded-value",
        message:
          "Unspecified/object payload needs an explicit opaque contract or a detailed schema.",
      });
  }
  const pathField = (path) =>
    fields.find((x) => x.path === parameterPath(path));
  for (const rule of documentation?.usage?.rules ?? []) {
    const used =
      rule.kind === "sumMaximum"
        ? rule.paths
        : [
            rule.path,
            ...(rule.target ? [rule.target] : []),
            ...(rule.via ? [rule.via.source, rule.via.target] : []),
          ];
    for (const path of used)
      if (!pathField(path))
        issues.push({
          path: parameterPath(path),
          code: "unknown-rule-path",
          message: "Relation references a missing schema path.",
        });
    if (
      rule.kind === "index" &&
      !pathField(rule.target)?.schemas.some(
        (x) => object(x) && x.type === "array",
      )
    )
      issues.push({
        path: parameterPath(rule.target),
        code: "index-target",
        message: "Index target must be an array.",
      });
    if (
      rule.kind === "index" &&
      !pathField(rule.path)?.schemas.some(
        (x) =>
          object(x) &&
          (x.type === "integer" ||
            (Array.isArray(x.type) && x.type.includes("integer"))),
      )
    )
      issues.push({
        path: parameterPath(rule.path),
        code: "index-type",
        message: "An index parameter must be an integer.",
      });
    if (
      rule.kind === "sumMaximum" &&
      rule.paths.some(
        (path) =>
          !pathField(path)?.schemas.some(
            (x) => object(x) && ["number", "integer"].includes(x.type),
          ),
      )
    )
      issues.push({
        path: parameterPath(rule.paths[0]),
        code: "sum-type",
        message: "Coordinate sums require numeric parameters.",
      });
    const patterns = used.map((p) =>
      parameterPath(p).split("/").filter(Boolean),
    );
    if (
      rule.kind === "sumMaximum" &&
      patterns.some(
        (p) =>
          JSON.stringify(
            p
              .map((x, i) => (x === "*" ? p.slice(0, i).join("/") : null))
              .filter((x) => x !== null),
          ) !==
          JSON.stringify(
            patterns[0]
              .map((x, i) =>
                x === "*" ? patterns[0].slice(0, i).join("/") : null,
              )
              .filter((x) => x !== null),
          ),
      )
    )
      issues.push({
        path: parameterPath(rule.paths[0]),
        code: "sum-scope",
        message: "Sum parameters must share the same array scopes.",
      });
  }
  return issues;
}
export function assertParameterContract(schema, documentation) {
  if (documentation?.version !== 2) return;
  const issues = parameterContractIssues(schema, documentation);
  if (issues.length)
    throw new Error(
      "Invalid component parameter contract: " +
        issues.map((x) => x.path + " " + x.code).join("; "),
    );
}
/** Self-contained so exactly this implementation can be embedded in an offline sandbox. */
export function parameterRuleIssues(data, rules = []) {
  function parts(path) {
    return path.startsWith("/")
      ? path
          .slice(1)
          .split("/")
          .map((x) => x.replace(/~1/g, "/").replace(/~0/g, "~"))
      : path.replace(/\[\]/g, ".*").split(".");
  }
  function collect(path) {
    const tokens = parts(path),
      out = [];
    function walk(value, index, bindings = [], location = "") {
      if (index === tokens.length) {
        out.push({ value, bindings, location });
        return;
      }
      const token = tokens[index];
      if (token === "*") {
        if (Array.isArray(value))
          value.forEach((item, i) =>
            walk(
              item,
              index + 1,
              [
                ...bindings,
                {
                  scope: tokens
                    .slice(0, index)
                    .map((x) => x.replace(/~/g, "~0").replace(/\//g, "~1"))
                    .join("/"),
                  index: i,
                },
              ],
              location + "/" + i,
            ),
          );
      } else if (
        value &&
        typeof value === "object" &&
        Object.hasOwn(value, token)
      )
        walk(
          value[token],
          index + 1,
          bindings,
          location + "/" + token.replace(/~/g, "~0").replace(/\//g, "~1"),
        );
    }
    walk(data, 0);
    return out;
  }
  function matches(a, b) {
    return a.bindings.every((binding) =>
      b.bindings.every(
        (other) =>
          binding.scope !== other.scope || binding.index === other.index,
      ),
    );
  }
  const issues = [];
  const problem = (entry, message) =>
    issues.push({ path: entry.location, message });
  for (const rule of rules) {
    if (rule.kind === "unique") {
      const groups = new Map();
      for (const entry of collect(rule.path)) {
        const group = JSON.stringify(entry.bindings.slice(0, -1));
        if (!groups.has(group)) groups.set(group, new Set());
        const key = JSON.stringify(entry.value);
        if (groups.get(group).has(key))
          problem(entry, "Duplicate ID/value within its array.");
        groups.get(group).add(key);
      }
    } else if (rule.kind === "reference") {
      const targets = collect(rule.target);
      for (const entry of collect(rule.path))
        if (
          !rule.sentinelValues?.includes(entry.value) &&
          targets.filter(
            (target) => matches(entry, target) && entry.value === target.value,
          ).length !== 1
        )
          problem(
            entry,
            "Reference must identify exactly one existing target in this scope.",
          );
    } else if (rule.kind === "index") {
      const targets = collect(rule.target),
        sources = rule.via ? collect(rule.via.source) : [],
        ids = rule.via ? collect(rule.via.target) : [];
      for (const entry of collect(rule.path)) {
        if (rule.sentinelValues?.includes(entry.value)) continue;
        const candidates = targets.filter(
          (target) =>
            matches(entry, target) &&
            (!rule.via ||
              sources.some(
                (source) =>
                  matches(entry, source) &&
                  source.bindings.every((b) =>
                    entry.bindings.some(
                      (e) => b.scope === e.scope && b.index === e.index,
                    ),
                  ) &&
                  ids.some(
                    (id) =>
                      matches(target, id) &&
                      id.bindings.every((b) =>
                        target.bindings.some(
                          (t) => b.scope === t.scope && b.index === t.index,
                        ),
                      ) &&
                      source.value === id.value,
                  ),
              )),
        );
        if (
          candidates.length !== 1 ||
          !Array.isArray(candidates[0].value) ||
          !Number.isInteger(entry.value) ||
          entry.value < 0 ||
          entry.value >= candidates[0].value.length
        )
          problem(
            entry,
            "Index is outside the selected target array or target is ambiguous.",
          );
      }
    } else if (rule.kind === "sumMaximum") {
      const values = rule.paths.map(collect);
      for (const entry of values[0]) {
        const terms = [
          entry,
          ...values
            .slice(1)
            .map((items) =>
              items.find(
                (other) =>
                  matches(entry, other) &&
                  entry.bindings.length === other.bindings.length,
              ),
            ),
        ];
        if (terms.some((x) => !x)) continue;
        if (
          terms.some(
            (x) => typeof x.value !== "number" || !Number.isFinite(x.value),
          ) ||
          terms.reduce((n, x) => n + x.value, 0) > rule.maximum
        )
          problem(entry, "Coordinate extent exceeds " + rule.maximum + ".");
      }
    } else
      throw new Error("Unknown component parameter relation: " + rule.kind);
  }
  return issues;
}
export function parameterValues(data, path, maximum = 3) {
  const tokens = parameterPath(path)
      .slice(1)
      .split("/")
      .map((x) => x.replace(/~1/g, "/").replace(/~0/g, "~")),
    out = [];
  function walk(value, index, location = "") {
    if (out.length >= maximum) return;
    if (index === tokens.length) {
      out.push({ path: location, value });
      return;
    }
    const token = tokens[index];
    if (token === "*") {
      if (Array.isArray(value))
        value.forEach((item, i) => walk(item, index + 1, location + "/" + i));
    } else if (
      (object(value) || Array.isArray(value)) &&
      Object.hasOwn(value, token)
    )
      walk(value[token], index + 1, location + "/" + escape(token));
  }
  walk(data, 0);
  return out;
}
function schemaSummary(node) {
  if (typeof node === "boolean") return { accepts: node };
  const keys = [
    "type",
    "enum",
    "const",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minItems",
    "maxItems",
    "uniqueItems",
    "minProperties",
    "maxProperties",
    "additionalProperties",
  ];
  return Object.fromEntries(
    keys
      .filter(
        (k) =>
          (Object.hasOwn(node, k) && typeof node[k] !== "object") ||
          (["type", "enum", "const"].includes(k) && Object.hasOwn(node, k)),
      )
      .map((k) => [k, node[k]]),
  );
}
export function componentParameterReference(
  schema,
  documentation,
  defaultData = {},
  examples = [],
) {
  const fields = schemaParameters(schema),
    inputs = inputMap(documentation),
    issues = parameterContractIssues(schema, documentation);
  return {
    protocol: COMPONENT_PARAMETER_PROTOCOL,
    documentationVersion: documentation?.version ?? null,
    verifiedContract: documentation?.version === 2 && issues.length === 0,
    diagnostics: issues,
    entries: fields.map((field) => {
      const input = semantic(field, inputs),
        summaries = field.schemas.map(schemaSummary),
        schemaDefault = field.schemas.find(
          (x) => object(x) && Object.hasOwn(x, "default"),
        );
      const compact = (sample, source) => BufferlessSample(sample, source);
      function BufferlessSample(sample, source) {
        const serialized = JSON.stringify(sample.value);
        return serialized.length <= 1200
          ? { source, ...sample }
          : {
              source,
              path: sample.path,
              omitted: true,
              reason:
                "Large sample; read the corresponding exact example and field.",
              characters: serialized.length,
            };
      }
      return {
        path: field.path,
        required: field.required,
        ...(summaries.length === 1
          ? { constraints: summaries[0] }
          : {
              schemaFragments: summaries,
              composition:
                "Fragments retain the exact schema composition; they are not implicitly OR alternatives. Read the exact schema for allOf/oneOf/conditional combinations.",
            }),
        meaning: input?.meaning ?? null,
        ...(input?.context ? { context: input.context } : {}),
        ...(input?.units ? { units: input.units } : {}),
        ...(input?.coordinateSystem
          ? { coordinateSystem: input.coordinateSystem }
          : {}),
        ...(input?.opaque ? { opaque: true } : {}),
        omission:
          input?.omission ??
          (field.required === "required"
            ? {
                behavior: "reject",
                description: "Required by schema when its parent is present.",
              }
            : { behavior: "unspecified" }),
        ...(field.schemas.some((x) => object(x) && x.format)
          ? { formatIsAnnotation: true }
          : {}),
        ...(schemaDefault
          ? {
              schemaDefault: schemaDefault.default,
              schemaDefaultIsAnnotation: true,
            }
          : {}),
        samples: [
          ...parameterValues(defaultData, field.path, 1).map((x) =>
            compact(x, "defaultData"),
          ),
          ...examples
            .slice(0, 2)
            .flatMap((e, i) =>
              parameterValues(e.data, field.path, 1).map((x) =>
                compact(x, "example:" + i),
              ),
            ),
        ],
      };
    }),
    relations: documentation?.usage?.rules ?? [],
    defaultPolicy:
      "Samples are initialization/example values. Schema defaults are annotations; input is not automatically filled or normalized by this protocol. Omission behavior is authored and must agree with component implementation.",
  };
}

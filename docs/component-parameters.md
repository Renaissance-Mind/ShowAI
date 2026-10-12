# Versioned component parameter references

Component parameters have one source of truth: `props.schema.json` for machine structure, versioned `manifest.documentation.usage.inputs` for meaning and omission behavior, and actual `defaultData/examples` for sample values. `catalog_describe(view:"parameters")` generates the readable reference. No second handwritten parameter table is required.

## Authoring version 2

Keep the existing reuse, recipes, interactions, constraints, editing and development sections. Set documentation.version to 2. For each exposed schema parameter supply meaning in usage.inputs or schema.description. Paths accept dotted fields with [] or JSON pointer syntax with * array wildcards and ~0/~1 escapes. Primitive array items inherit their array explanation. Child fields inherit an authored parent unit/coordinate context unless overridden. A fixed zero-parameter component uses an empty input list and a closed empty-object schema. Optional or conditional fields need an explicit omission behavior. Unstructured external payloads need an explicit opaque explanation; describe the accepted format rather than claiming its internals are validated.

```json
{
  "path": "initialSlide",
  "meaning": "ID of the initially selected reading slide.",
  "omission": {
    "behavior": "fallback",
    "description": "When omitted, the renderer selects the first actual slide.",
    "from": {"path":"slides[].id", "selection":"first"}
  }
}
```

Omission behavior is reject, omit or fallback. A fallback declares exactly one JSON value, a first/last source parameter, or computedFrom input paths with a derivation description. Computed fallbacks remain renderer behavior: this protocol checks the paths, does not execute prose/formulas, and requires runtime verification. Schema-required fields cannot promise omission. String format is currently an annotation (format validation is disabled), and is marked as such in references. Initialization values and schema.default annotations are shown separately: this protocol never automatically fills or rewrites input. Declared renderer fallback behavior still requires actual interaction verification.

usage.rules supports unique values/IDs within an array, scoped references, zero-based indexes (optionally selecting the target array through an ID), and numeric sumMaximum extents. Each path must resolve to an actual schema parameter. For percentages, define individual x/y/w/h bounds in schema and x+w/y+h limits in rules. Units and coordinateSystem explain origin, axis directions and scale; they do not invent a validator for every possible physical unit.

The same portable relation function is used for default/example validation, actual Page writes, and compiled component validators, including offline and nested-component use. Unknown rule kinds fail; rule execution does not evaluate code or access a service. Missing optional values remain absent. Existing v1 packages remain readable and unchanged; their generated references expose missing meanings, omission behavior and unconstrained fields. A v1 presence flag is not v2 completeness.

## Progressive querying

Check showai_capabilities.componentParameters.protocol for showai-component-parameters-v1. Read catalog metadata first, then the exact component guide. Version 2 guides link to the parameter reference rather than returning a duplicate full schema.

```json
{
  "projectId":"PROJECT", "kind":"component", "id":"COMPONENT",
  "scope":"project", "version":"1.0.0", "integrity":"sha256-…",
  "view":"parameters", "parameterPath":"slides[].regions[].box",
  "parameterLimit":20
}
```

Each page contains constraints, meanings, omission behavior, real sample values and relevant relations; references retain the exact component identity. Pagination uses parameterOffset/parameterLimit (default20, maximum50) and nextPage. knownHash suppresses repeated text for a held identical page; authorization and identity are still checked. Responses over64KiB require a smaller page/subtree rather than silent instruction truncation. Oversized example values are explicitly marked as omitted, with their actual example source and field path.

Local MCP, authorized HTTP MCP and anonymous public component queries share the same interface. CLI provides `catalog describe ID --view parameters --parameter-path PATH --parameter-offset N --parameter-limit N --known-hash HASH`. Parameter selectors apply only to the parameters view and components. Guide/schema/examples/development/source remain separately readable.

## What validation establishes

A validated v2 definition establishes schema/documentation consistency and declared relation checks. It does not prove every renderer uses documented fallbacks, every business constraint has been declared, or that readers understand the visualization. Check actual data changes, invalid edits, initial/empty states, reset, keyboard, narrow views and export separately. Template instructions choose and combine components; parameter meanings remain with the exact component revision.

无选择状态可在 reference/index 规则显式声明 sentinelValues，例如 index 的 [-1] 或 reference 的 [null]；字段schema也必须允许这些值，说明它们的实际意义。普通索引仍为零起始。未声明的负值、无效ID与歧义目标继续拒绝。

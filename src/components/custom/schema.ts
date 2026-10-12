import { CAPACITY, assertContent } from "../../portable/capacity.mjs";
import Ajv from "ajv";
import {
  assertParameterContract,
  parameterRuleIssues,
  schemaParameters,
  parameterPath,
  parameterValues,
} from "../../portable/component-parameters.mjs";
import type { ComponentDocumentation } from "./documentation";
import type { ValidateFunction } from "ajv";
import type { JsonSchema } from "./types";
import { assertJsonValue } from "./contract";
export { assertJsonValue } from "./contract";

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
  validateFormats: false,
  addUsedSchema: false,
});
const validators = new Map<string, ValidateFunction>();

export function assertProps(
  schema: JsonSchema,
  props: unknown,
  documentation?: ComponentDocumentation,
): asserts props is Record<string, unknown> {
  assertJsonValue(props);
  assertContent(props, "Component instance data", CAPACITY.componentPropsBytes);
  if (!props || typeof props !== "object" || Array.isArray(props))
    throw new Error("Component props must be an object.");
  const key = JSON.stringify(schema);
  let validate = validators.get(key);
  if (!validate) {
    validate = ajv.compile(schema);
    if (validators.size >= 100) validators.clear();
    validators.set(key, validate);
  }
  if (!validate(props))
    throw new Error(
      `Invalid component props: ${ajv.errorsText(validate.errors)}.`,
    );
  const issues = parameterRuleIssues(
    props,
    documentation?.version === 2 ? documentation.usage.rules : [],
  );
  if (issues.length)
    throw new Error(
      "Invalid component relations: " +
        issues.map((x) => x.path + " " + x.message).join("; "),
    );
}

export function assertParameterDefinition(
  schema: JsonSchema,
  documentation?: ComponentDocumentation,
  samples: Record<string, unknown>[] = [],
) {
  assertParameterContract(schema, documentation);
  if (documentation?.version !== 2) return;
  const fields = schemaParameters(schema);
  for (const rule of documentation.usage.rules ?? []) {
    if (!("sentinelValues" in rule) || !rule.sentinelValues) continue;
    const field = fields.find((f) => f.path === parameterPath(rule.path))!;
    const validate = ajv.compile({
      ...(typeof schema === "object" && schema.definitions
        ? { definitions: schema.definitions }
        : {}),
      ...(typeof schema === "object" && schema.$defs
        ? { $defs: schema.$defs }
        : {}),
      anyOf: field.schemas,
    });
    if (rule.sentinelValues.some((value) => !validate(value)))
      throw new Error(
        "No-selection sentinel does not satisfy schema: " + rule.path,
      );
  }

  for (const input of documentation.usage.inputs) {
    if (input.omission?.behavior !== "fallback" || input.omission.computedFrom)
      continue;
    const field = fields.find((f) => f.path === parameterPath(input.path))!;
    const validate = ajv.compile({
      ...(typeof schema === "object" && "definitions" in schema
        ? { definitions: schema.definitions }
        : {}),
      ...(typeof schema === "object" && "$defs" in schema
        ? { $defs: schema.$defs }
        : {}),
      anyOf: field.schemas,
    });
    const values = input.omission.from
      ? samples.flatMap((sample) => {
          const matches = parameterValues(
            sample,
            input.omission!.from!.path,
            10000,
          );
          const value =
            input.omission!.from!.selection === "first"
              ? matches[0]
              : matches.at(-1);
          return value ? [value.value] : [];
        })
      : [input.omission.value];
    if (values.some((value) => !validate(value)))
      throw new Error(
        "Fallback does not satisfy parameter schema: " + input.path,
      );
  }
}

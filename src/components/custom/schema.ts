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

function validator(schema: JsonSchema) {
  const key = JSON.stringify(schema);
  let validate = validators.get(key);
  if (!validate) {
    validate = ajv.compile(schema);
    if (validators.size >= 100) validators.clear();
    validators.set(key, validate);
  }
  return validate;
}

export interface PropsIssue {
  /** JSON pointer inside props, e.g. /objectives/0/title ("" for props itself). */
  path: string;
  message: string;
  kind: "schema" | "relation";
}

/**
 * Schema and relation problems of props without throwing, so callers can
 * report every field (component.ref.set checks props against a new revision).
 * Structural limits (JSON values, size) still throw like assertProps.
 */
export function propsIssues(
  schema: JsonSchema,
  props: unknown,
  documentation?: ComponentDocumentation,
): PropsIssue[] {
  assertJsonValue(props);
  assertContent(props, "Component instance data", CAPACITY.componentPropsBytes);
  if (!props || typeof props !== "object" || Array.isArray(props))
    return [{ path: "", message: "must be an object", kind: "schema" }];
  const validate = validator(schema);
  if (!validate(props))
    return (validate.errors ?? []).map((error) => ({
      path:
        error.instancePath +
        (error.keyword === "required" &&
        typeof error.params?.missingProperty === "string"
          ? `/${error.params.missingProperty}`
          : error.keyword === "additionalProperties" &&
              typeof error.params?.additionalProperty === "string"
            ? `/${error.params.additionalProperty}`
            : ""),
      message: error.message ?? error.keyword,
      kind: "schema" as const,
    }));
  return parameterRuleIssues(
    props,
    documentation?.version === 2 ? documentation.usage.rules : [],
  ).map((issue: { path: string; message: string }) => ({
    path: issue.path,
    message: issue.message,
    kind: "relation" as const,
  }));
}

export function assertProps(
  schema: JsonSchema,
  props: unknown,
  documentation?: ComponentDocumentation,
): asserts props is Record<string, unknown> {
  assertJsonValue(props);
  assertContent(props, "Component instance data", CAPACITY.componentPropsBytes);
  if (!props || typeof props !== "object" || Array.isArray(props))
    throw new Error("Component props must be an object.");
  const validate = validator(schema);
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

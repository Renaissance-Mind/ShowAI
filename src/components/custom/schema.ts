import { CAPACITY, assertContent } from "../../portable/capacity.mjs";
import Ajv from "ajv";
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
}

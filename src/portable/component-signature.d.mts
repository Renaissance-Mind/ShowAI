import type { JsonSchema } from "../contract/types";
export const COMPONENT_SIGNATURE_LIMIT: 320;
export function componentSignature(
  id: string,
  schema: JsonSchema | undefined,
  limit?: number,
): string;

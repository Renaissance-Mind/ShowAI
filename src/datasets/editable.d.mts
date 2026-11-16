import type { ResolvedBinding } from "./binding.mjs";
import type { Editable } from "./warnings.mjs";

export declare function bindingEditable(
  resolved: Pick<ResolvedBinding, "compiled" | "projected" | "writable">,
): Editable;
export { canEdit, componentDataState } from "../lib/component-editability.mjs";

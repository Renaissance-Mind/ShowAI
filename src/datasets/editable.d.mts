import type { ResolvedBinding } from "./binding.mjs";
import type { Editable } from "./warnings.mjs";

export declare function bindingEditable(
  resolved: Pick<ResolvedBinding, "compiled" | "projected" | "writable">,
): Editable;
export declare function canEdit(
  editable: Editable | undefined,
  prop: string,
  itemId?: string,
  field?: string,
): boolean;
export declare function componentDataState(
  value: unknown,
  readOnly: boolean,
  check?: typeof canEdit,
): {
  status: "ok" | "stale" | "empty";
  editable: Editable;
  canEdit: (prop: string, itemId?: string, field?: string) => boolean;
};

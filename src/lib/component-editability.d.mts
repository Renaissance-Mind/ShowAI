export type ComponentEditable = boolean | { paths: string[] };
export function canEdit(
  editable: ComponentEditable | undefined,
  prop: string,
  itemId?: string,
  field?: string,
): boolean;
export function componentDataState(
  value: unknown,
  readOnly: boolean,
  check?: typeof canEdit,
): {
  status: "ok" | "stale" | "empty";
  editable: ComponentEditable;
  canEdit(prop: string, itemId?: string, field?: string): boolean;
};

export interface MultiLevelTarget {
  type: string;
  scope: string;
  id: string;
}
export interface MultiLevelView {
  id: string;
  parentId: string | null;
  label: string;
  content?: { type: "doc"; content: import("@tiptap/core").JSONContent[] };
  component?: { kind: string; props: Record<string, unknown> };
  bindings: {
    event?: string;
    blockId?: string;
    source: MultiLevelTarget;
    to: string;
  }[];
}
export interface MultiLevelViewData extends Record<string, unknown> {
  title: string;
  root: string;
  levels: MultiLevelView[];
}
export declare const MULTI_LEVEL_LIMITS: {
  levels: number;
  bindings: number;
  widgets: number;
};
export declare function validateMultiLevelViewData(
  data: unknown,
  validateChild?: (kind: string, data: Record<string, unknown>) => void,
): MultiLevelViewData;
export declare function multiLevelContent(level: MultiLevelView): {
  type: "doc";
  content: import("@tiptap/core").JSONContent[];
};
export declare function multiLevelWidgets(level: MultiLevelView): {
  type: string;
  attrs: { id: string; kind: string; data: Record<string, unknown> };
}[];
export declare function multiLevelBindingBlock(
  level: MultiLevelView,
  binding: MultiLevelView["bindings"][number],
): string;
export declare function multiLevelTargets(
  kind: string,
  props: Record<string, unknown>,
): MultiLevelTarget[] | undefined;
export declare function sameMultiLevelTarget(
  a: MultiLevelTarget,
  b: MultiLevelTarget,
): boolean;
export declare function multiLevelPath(
  levels: Map<string, MultiLevelView>,
  id: string,
): MultiLevelView[];

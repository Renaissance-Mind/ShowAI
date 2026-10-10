export interface DiagramData extends Record<string, unknown> {
  title?: string;
  description?: string;
  type: "flow" | "sequence";
  source: string;
  direction?: "TB" | "LR" | "BT" | "RL";
  numbered?: boolean;
}
export function inspect(data: DiagramData): {
  warnings?: { line: number; message: string }[];
  empty?: boolean;
  [key: string]: unknown;
};
export function renderDiagram(
  data: DiagramData,
  uid: string,
): { model: ReturnType<typeof inspect>; html: string };
export const syntax: Record<DiagramData["type"], string>;

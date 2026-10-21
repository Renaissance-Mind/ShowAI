import type { ShowDocument } from "../types";
import type { InkOperationIdentity, InkOperationChange } from "./ink-operations.mjs";
export const INK_WIRE_FORMAT: "showai-ink-state-v1";
export class InkWireError extends Error { readonly code: "INK_CAUSAL_CONFLICT" }
export interface InkWireConflict { boardId?: string; strokeId?: string; field: string; reason: string }
export interface InkWireState {
  format: typeof INK_WIRE_FORMAT;
  clock: Record<string, number>;
  level: number;
  contexts: Record<string, Record<string, number>>;
  strokes: Record<string, { born: [number, string, number]; fields: Record<string, [string, string][]>; variants?: Record<string, Record<string, unknown>>; unplaced?: true }>;
}
export interface PreparedInkPageMerge {
  base: ShowDocument; ours: ShowDocument; theirs: ShowDocument;
  plans: unknown[]; conflicts: InkWireConflict[];
}
export function validateInkWireState(value: unknown): InkWireState;
export function stampInkDocument(document: ShowDocument, baseline: ShowDocument | undefined, identity: InkOperationIdentity & { changes?: InkOperationChange[] }): ShowDocument;
export function inkWireClockForActor(document: ShowDocument, actor: string): number;
export function hasInkWireContent(document: ShowDocument): boolean;
export function prepareInkPageMerge(base: ShowDocument, ours: ShowDocument, theirs: ShowDocument): PreparedInkPageMerge | null;
export function finishInkPageMerge(document: ShowDocument, prepared: PreparedInkPageMerge): { document: ShowDocument; conflicts: InkWireConflict[] };
export function resolveInkWireFields(document: ShowDocument, choices: { boardId: string; strokeId: string; field: string; hash: string }[], identity: InkOperationIdentity): ShowDocument;

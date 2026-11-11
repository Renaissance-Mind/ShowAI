import type { PageReferenceItem } from "../components/page-references";

export interface ReferenceSnapshot {
  page: { projectId: string; pageId: string };
  to: PageReferenceItem[];
  from: PageReferenceItem[];
  /** Distinct pages in each direction, counted before the lists were cut. */
  pages?: { to: number; from: number };
}
export const REFERENCE_SNAPSHOT_LIMIT: number;
export function validateReferenceSnapshot(value: unknown): ReferenceSnapshot;

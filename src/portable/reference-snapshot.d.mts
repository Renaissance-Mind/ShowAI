import type { PageReferenceItem } from "../components/page-references";

export interface ReferenceSnapshot {
  page: { projectId: string; pageId: string };
  to: PageReferenceItem[];
  from: PageReferenceItem[];
}
export const REFERENCE_SNAPSHOT_LIMIT: number;
export function validateReferenceSnapshot(value: unknown): ReferenceSnapshot;

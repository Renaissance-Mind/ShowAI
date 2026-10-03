import type { ShowArtifact, ShowDocument } from "../types";
import type { CompiledComponent } from "../components/custom/types";
export const MAX_ARTIFACT_BYTES: number;
export const ARTIFACT_DATA_ID: string;
export function isSafeUrl(value: unknown, image?: boolean): boolean;
export function validateDocument(value: unknown): ShowDocument;
export function parseArtifact(input: unknown): ShowArtifact;
export function serializeArtifact(document: ShowDocument, components?: CompiledComponent[]): string;
export function escapeJsonForHtml(value: unknown): string;
export function injectArtifactIntoHtml(
  template: string,
  document: ShowDocument,
  components?: CompiledComponent[],
): string;

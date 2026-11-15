import type { ShowArtifact, ShowDocument } from "../types";
import type { CompiledComponent } from "../contract/types";
import type { PublishedComponentLocator } from "./publication-types";
export const MAX_ARTIFACT_BYTES: number;
export const ARTIFACT_DATA_ID: string;
export function isSafeUrl(value: unknown, image?: boolean): boolean;
export function isImageSource(value: unknown): boolean;
export function validateDocument(value: unknown): ShowDocument;
export function isDocumentTimestamp(value: unknown): boolean;
export function parseArtifactWithValidatedDocument(input: unknown, heldDocument: ShowDocument): ShowArtifact;
export function parseArtifact(input: unknown): ShowArtifact;
export function parseArtifactConsumingDocument(input: unknown): ShowArtifact;
export function serializeArtifact(
  document: ShowDocument,
  components?: CompiledComponent[],
  remoteComponents?: PublishedComponentLocator[],
  presentation?: "spatial" | "reading",
  selection?: ShowArtifact["selection"],
  references?: ShowArtifact["references"],
): string;
export function escapeJsonForHtml(value: unknown): string;
export function injectArtifactIntoHtml(
  template: string,
  document: ShowDocument,
  components?: CompiledComponent[],
  remoteComponents?: PublishedComponentLocator[],
  presentation?: "spatial" | "reading",
  selection?: ShowArtifact["selection"],
  references?: ShowArtifact["references"],
): string;
export function parseArtifactForSourceSnapshot(input:unknown):ShowArtifact;
export function parseArtifactConsumingForSourceSnapshot(input:unknown,observer?:(stage:string,milliseconds:number)=>void):ShowArtifact;
export function shareSourceSnapshotDocument<T extends ShowDocument>(base:T,canonical:T):T;
export function inheritSourceSnapshotTimestampCapacity(base:ShowDocument,body:ShowDocument):boolean;
export function assertOwnedSourceDocumentCapacity(body:ShowDocument):import("./capacity.mjs").ContentSize;

export function hasSourceSnapshotCapacity(body:unknown):boolean;
export function validateSubtree(
  node: unknown,
  context: {
    path: string;
    parentPath: string;
    parentType: string;
    depth: number;
    count: number;
    surface: boolean;
    resource: boolean;
  },
): number;

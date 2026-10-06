import type { Plugin } from "vite";
export interface BuildIdentity {
  version: string;
  pageModelVersion: number;
  supportedArtifactVersions: number[];
  sourceCommit: string;
  sourceDirty: boolean | null;
}
export function buildIdentity(): BuildIdentity;
export function frontendManifest(
  directory?: string,
): BuildIdentity & { frontendFiles: Record<string, string> };
export function buildIdentityPlugin(): Plugin;

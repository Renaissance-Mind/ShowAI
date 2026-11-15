import type { SnapshotRecord, SyncProject } from "./protocol";
import type { SnapshotDelta } from "./delta";

export const eventProtocol = "showai-project-events-v1";
export const eventCapability = "project-events-v1";
export const inlineRevisionCapability = "inline-revisions-v1";
export const maximumEventBytes = 512 * 1024;
export const maximumEventInput = 64 * 1024;
export const maximumEventProjects = 1000;

export type ProjectEvent =
  | { type: "heads"; serverId: string; projects: SyncProject[] }
  | {
      type: "revision";
      serverId: string;
      project: SyncProject;
      previousHead?: string | null;
      sequence?: number;
      previousSequence?: number;
      record?: SnapshotRecord;
      delta?: SnapshotDelta;
      objects?: Record<string, string>;
    }
  | { type: "pong" }
  | { type: "error"; code: string; message: string };

export interface EventIdentity {
  userId: string;
  sessionDigest: string;
  projects: string[];
  features?: string[];
}

export function eventCredential(request: Request): string | undefined {
  const header = request.headers
    .get("authorization")
    ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (header) return header;
  return request.headers
    .get("sec-websocket-protocol")
    ?.split(",")
    .map((value) => value.trim())
    .find((value) => /^token-[a-f0-9]{64}$/.test(value))
    ?.slice(6);
}

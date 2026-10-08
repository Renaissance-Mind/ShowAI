/** Shared by Workers, Linux and the local application. No host filesystem APIs. */
export const syncProtocol = "showai-project-sync-v2";
export const legacySyncProtocol = "showai-project-sync-v1";
export type ProjectRole = "admin" | "editor" | "viewer";
export interface SyncUser {
  id: string;
  name: string;
}
export interface SyncProject {
  id: string;
  name: string;
  head: string | null;
  role: ProjectRole;
  archived: boolean;
}
export interface SyncChange {
  at: string;
  actor: {
    kind: "human" | "agent" | "system" | "external" | "unknown";
    label?: string;
    harness?: string;
    sessionId?: string;
    turnId?: string;
  };
  channel: "desktop" | "browser" | "cli" | "mcp" | "external" | "system";
  message?: string;
  operationId: string;
  sourceRevision?: string;
  deviceId?: string;
  restoredFrom?: string;
  mergedFrom?: string;
  paths: string[];
}
export interface ProjectSnapshot {
  format: typeof syncProtocol | typeof legacySyncProtocol;
  projectId: string;
  parents: string[];
  files: Record<string, string>;
  change: SyncChange;
}
export interface SnapshotRecord {
  revision: string;
  snapshot: ProjectSnapshot;
  source?: { user: SyncUser; receivedAt: string };
}
export class SyncError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
export const identifier = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
  )
    throw new SyncError(400, "INVALID_ID", "Invalid identifier.");
  return value;
};
export const digestId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new SyncError(400, "INVALID_DIGEST", "Invalid content digest.");
  return value;
};
export const plainText = (value: unknown, max = 1000): string => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
  )
    throw new SyncError(400, "INVALID_TEXT", "Non-empty text is required.");
  return value.trim();
};
export function role(value: unknown): ProjectRole {
  if (value !== "admin" && value !== "editor" && value !== "viewer")
    throw new SyncError(400, "INVALID_ROLE", "Choose admin, editor or viewer.");
  return value;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function legacyCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(legacyCanonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${legacyCanonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export async function hash(bytes: Uint8Array | string): Promise<string> {
  const input =
    typeof bytes === "string"
      ? new TextEncoder().encode(bytes)
      : Uint8Array.from(bytes);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", input)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function token(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function scopedPath(path: string, projectId: string): string {
  if (
    !path ||
    path.length > 2000 ||
    path.includes("\\") ||
    /[<>:"|?*]/.test(path) ||
    /[\x00-\x1f]/.test(path) ||
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/.test(part) ||
          /^(?:\.git|\.sync)$/i.test(part) ||
          /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part),
      ) ||
    !(
      path.startsWith(`projects/${identifier(projectId)}/`) ||
      /^assets\/[a-f0-9]{64}$/.test(path) ||
      /^runtimes\/readers\/[a-f0-9]{64}\//.test(path) ||
      /^packages\/(?:published\/)?(?:components|templates)\//.test(path)
    )
  )
    throw new SyncError(
      400,
      "INVALID_PATH",
      "Content must belong to this project or its dependencies.",
    );
  return path;
}
export function portablePathKey(path: string): string {
  return path.normalize("NFC").toUpperCase().normalize("NFC");
}
export function validateSnapshot(
  value: unknown,
  projectId: string,
): ProjectSnapshot {
  if (!value || typeof value !== "object")
    throw new SyncError(
      400,
      "INVALID_SNAPSHOT",
      "A project snapshot is required.",
    );
  const input = value as ProjectSnapshot;
  if (
    (input.format !== syncProtocol && input.format !== legacySyncProtocol) ||
    input.projectId !== projectId ||
    !Array.isArray(input.parents) ||
    input.parents.length > 2 ||
    new Set(input.parents).size !== input.parents.length ||
    !input.files ||
    typeof input.files !== "object" ||
    Array.isArray(input.files) ||
    !input.change
  )
    throw new SyncError(400, "INVALID_SNAPSHOT", "Invalid project snapshot.");
  input.parents.forEach(digestId);
  const paths = Object.keys(input.files);
  if (
    paths.length > 100_000 ||
    !input.files[`projects/${projectId}/project.json`]
  )
    throw new SyncError(
      400,
      "INVALID_SNAPSHOT",
      "A project snapshot requires its metadata.",
    );
  for (const path of paths) {
    scopedPath(path, projectId);
    digestId(input.files[path]);
  }
  const portablePaths = paths.map(portablePathKey);
  if (new Set(portablePaths).size !== paths.length)
    throw new SyncError(
      400,
      "INVALID_PATH",
      "Snapshot paths collide on a case-insensitive filesystem.",
    );
  const change = input.change;
  if (
    !Number.isFinite(Date.parse(change.at)) ||
    !change.actor ||
    !["human", "agent", "system", "external", "unknown"].includes(
      change.actor.kind,
    ) ||
    !["desktop", "browser", "cli", "mcp", "external", "system"].includes(
      change.channel,
    ) ||
    !Array.isArray(change.paths)
  )
    throw new SyncError(
      400,
      "INVALID_CHANGE",
      "Invalid historical change metadata.",
    );
  plainText(change.operationId, 1000);
  change.paths.forEach((path) => scopedPath(path, projectId));
  if (change.actor.label) {
    plainText(change.actor.label);
    if (/[<>\r\n]/.test(change.actor.label))
      throw new SyncError(
        400,
        "INVALID_ACTOR",
        "Actor labels cannot contain angle brackets or line breaks.",
      );
  }
  if (change.actor.kind === "agent") {
    plainText(change.actor.harness, 1000);
    plainText(change.actor.sessionId, 1000);
    if (/[<>\r\n]/.test(`${change.actor.harness}:${change.actor.sessionId}`))
      throw new SyncError(
        400,
        "INVALID_ACTOR",
        "Agent attribution must be safe to preserve in version history.",
      );
  }
  if (change.message) plainText(change.message, 10000);
  if (change.deviceId) identifier(change.deviceId);
  return input;
}
export async function snapshotRevision(
  snapshot: ProjectSnapshot,
): Promise<string> {
  return hash(
    snapshot.format === legacySyncProtocol
      ? legacyCanonical(snapshot)
      : canonical(snapshot),
  );
}

export interface ServerConnection {
  id: string;
  serverId: string;
  name: string;
  url: string;
  user: SyncUser;
  token: string;
  capabilities?: string[];
}
export interface ProjectConnection {
  projectId: string;
  connectionId: string;
  remoteProjectId: string;
  role: ProjectRole;
  remoteHead: string | null;
  localRevision: string | null;
  status:
    "pending" | "synced" | "offline" | "conflict" | "revoked" | "save-failed";
  error?: string;
  syncedAt?: string;
  pendingCreation?: boolean;
}
export interface SyncConfiguration {
  version: 1;
  deviceId: string;
  connections: ServerConnection[];
  projects: ProjectConnection[];
  defaultConnectionId: string | null;
  defaultSince?: string;
}

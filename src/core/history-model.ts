export interface ChangeActor {
  kind: "human" | "agent" | "system" | "external" | "unknown";
  harness?: string;
  sessionId?: string;
  turnId?: string;
  label?: string;
}

export interface ChangeContext {
  actor: ChangeActor;
  channel: "desktop" | "browser" | "cli" | "mcp" | "external" | "system";
  message?: string;
  operationId?: string;
  groupId?: string;
  restoredFrom?: string;
  mergedFrom?: string;
  externalConflictId?: string;
  /** A legacy content snapshot is not a chronological Git revision. */
  restoredSnapshot?: { importId: string; snapshotId: string };
  /** Generated from validated API arguments before server dates/IDs are allocated. */
  requestFingerprint?: string;
}

export interface HistoryResource {
  kind: "page" | "project" | "component" | "template" | "library";
  id: string;
  projectId?: string;
  path: string;
}

export interface ChangeRecord extends ChangeContext {
  format: "showai-change";
  version: 1;
  operationId: string;
  requestHash: string;
  response?: import("./history-response").ResponseDescriptor;
  at: string;
  resources: HistoryResource[];
  paths: string[];
}

export interface HistoryEntry extends ChangeRecord {
  revision: string;
  parents: string[];
  workspaceConflicts?: import("./workspace-conflicts").WorkspaceConflict[];
}

export interface LibraryManifest {
  format: "showai-library";
  version: 2;
  id: string;
  createdAt: string;
}

export type FileChanges = Map<string, Buffer | null>;

export function resourceForPath(path: string): HistoryResource {
  const page = path.match(/^projects\/([^/]+)\/pages\/([^/]+)\.json$/);
  if (page) return { kind: "page", projectId: page[1], id: page[2], path };
  const project = path.match(/^projects\/([^/]+)\/project\.json$/);
  if (project)
    return { kind: "project", projectId: project[1], id: project[1], path };
  const pkg = path.match(
    /^(?:projects\/([^/]+)\/)?packages\/(?:published\/)?(components|templates)\/([^/]+)(?:\/([^/]+))?/,
  );
  if (pkg)
    return {
      kind: pkg[2] === "components" ? "component" : "template",
      id: `${pkg[3]}${pkg[4] ? `@${pkg[4]}` : ""}`,
      ...(pkg[1] ? { projectId: pkg[1] } : {}),
      path: path
        .split("/")
        .slice(0, path.split("/").indexOf(pkg[3]) + (pkg[4] ? 2 : 1))
        .join("/"),
    };
  return { kind: "library", id: path, path };
}

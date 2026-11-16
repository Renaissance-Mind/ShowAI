import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { NodeLayout, SavedView } from "../document/types";
import type {
  DiagramDirection,
  DiagramInsertInput,
} from "../document/diagram.mjs";

export type { ShowArtifact, ShowDocument } from "../types";
export type { JSONContent } from "@tiptap/core";

export interface ProjectBinding {
  harness: string;
  sessionId: string;
  sourceDirectory?: string;
}

export type DirectorySortBy = "name" | "createdAt" | "updatedAt" | "manual";

export interface DirectoryPreferences {
  sortBy?: DirectorySortBy;
  manualOrder?: string[];
}

export interface ProjectMetadata extends DirectoryPreferences {
  format: "showai-project";
  version: 1;
  id: string;
  name: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
  sourceDirectory?: string;
  binding?: ProjectBinding;
  bindings?: ProjectBinding[];
  pinned?: boolean;
  archived?: boolean;
  folders?: FolderMetadata[];
}

export interface FolderMetadata extends DirectoryPreferences {
  id: string;
  name: string;
  icon?: string;
  parentId: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends ProjectMetadata {
  pageCount: number;
}

export interface UnreadableProject {
  directory: string;
  path: string;
  code: string;
  message: string;
}

export interface ProjectGroup {
  id: string;
  name: string;
}

export interface SidebarOrganization {
  groups: ProjectGroup[];
  projectGroups: Record<string, string>;
  projectOrder?: string[];
  entryOrder?: Record<string, string[]>;
}

export interface SidebarEntryMove {
  reorderOnly?: boolean;
  kind: "page" | "folder";
  projectId: string;
  id: string;
  destinationProjectId: string;
  parentId: string | null;
  relativeId?: string;
  placement?: "before" | "after";
  baseHash?: string;
  baseRevision?: string;
}

export interface PageRecord {
  retainedSyncConflicts?: import("../sync/conflict-retention").RetainedConflict[];
  revision?: string;
  workspaceConflicts?: import("./workspace-conflicts").WorkspaceConflict[];
  document: ShowDocument;
  hash: string;
  path: string;
}

export interface PageSummary {
  revision?: string;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  icon: string;
  hash: string;
  blockCount: number;
  agentCreated?: import("./agent-created").AgentCreatedMark;
  parentId: string | null;
  favorite: boolean;
  archived: boolean;
}

export type PageFields = Partial<
  Pick<
    ShowDocument,
    | "title"
    | "icon"
    | "cover"
    | "parentId"
    | "favorite"
    | "archived"
    | "comments"
    | "layout"
    | "views"
    | "surfaceViews"
    | "templateContext"
  >
>;

export type PageOperation =
  | {
      type: "component.insert";
      kind: string;
      data: Record<string, unknown>;
      parentId?: string | null;
      afterId?: string | null;
    }
  | { type: "surface.upgrade" }
  | {
      type: "surface.create";
      kind: "page" | "board";
      name?: string;
      nodeId?: string;
      parentId?: string | null;
    }
  | { type: "surface.wrap"; nodeId?: string; kind: "page" | "board" }
  | { type: "surface.layout.set"; nodeId: string; layout: Partial<NodeLayout> }
  | {
      type: "surface.view.save";
      surfaceId?: string;
      view: SavedView;
      initial?: boolean;
    }
  | { type: "surface.view.remove"; surfaceId?: string; viewId: string }
  | { type: "surface.reading-order.set"; surfaceId?: string; nodeIds: string[] }
  | { type: "page.set"; fields: PageFields }
  | {
      type: "block.insert";
      node: JSONContent;
      parentId?: string | null;
      afterId?: string | null;
    }
  | { type: "block.remove"; blockId: string }
  | { type: "block.replace"; blockId: string; node: JSONContent }
  | {
      type: "block.move";
      blockId: string;
      parentId?: string | null;
      afterId?: string | null;
    }
  | { type: "block.attrs.set"; blockId: string; attrs: Record<string, unknown> }
  | {
      type: "component.props.set";
      blockId: string;
      props: Record<string, unknown>;
    }
  | { type: "block.text.set"; blockId: string; text: string }
  | {
      type: "component.ref.set";
      contract?:
        import("../contract/component-contract.mjs").ComponentContract | null;
      blockId: string;
      componentId?: string;
      version: string;
      integrity: string;
    }
  | {
      type: "component.binding.set";
      blockId: string;
      binding: Record<string, unknown>;
    }
  | {
      type: "component.binding.remove";
      blockId: string;
      keep?: "snapshot" | "local";
    }
  | ({ type: "diagram.insert" } & DiagramInsertInput)
  | {
      type: "comment";
      text?: string;
      blockId?: string;
      quote?: string;
      threadId?: string;
      resolved?: boolean;
    }
  | {
      type: "diagram.arrange";
      nodeIds: string[];
      direction?: DiagramDirection;
    };

export const PAGE_OPERATION_FIELDS = {
  "component.insert": ["kind", "data", "parentId", "afterId"],
  "surface.upgrade": [],
  "surface.create": ["kind", "name", "nodeId", "parentId"],
  "surface.wrap": ["nodeId", "kind"],
  "surface.layout.set": ["nodeId", "layout"],
  "surface.view.save": ["surfaceId", "view", "initial"],
  "surface.view.remove": ["surfaceId", "viewId"],
  "surface.reading-order.set": ["surfaceId", "nodeIds"],
  "page.set": ["fields"],
  "block.insert": ["node", "parentId", "afterId"],
  "block.remove": ["blockId"],
  "block.replace": ["blockId", "node"],
  "block.move": ["blockId", "parentId", "afterId"],
  "block.attrs.set": ["blockId", "attrs"],
  "component.props.set": ["blockId", "props"],
  "block.text.set": ["blockId", "text"],
  "component.ref.set": ["blockId", "componentId", "version", "integrity"],
  "component.binding.set": ["blockId", "binding"],
  "component.binding.remove": ["blockId", "keep"],
  "diagram.insert": [
    "parentId",
    "direction",
    "origin",
    "spacing",
    "nodes",
    "edges",
  ],
  "diagram.arrange": ["nodeIds", "direction"],
  comment: ["text", "blockId", "quote", "threadId", "resolved"],
} as const satisfies {
  [K in PageOperation["type"]]: readonly Exclude<
    keyof Extract<PageOperation, { type: K }>,
    "type"
  >[];
};

export interface ApplyPageInput {
  baseRevision?: string;
  baseHash: string;
  operations: PageOperation[];
  datasetBases?: Record<string, string>;
}

export interface FieldChange {
  field: string;
  before?: unknown;
  after?: unknown;
}

export type PageChange =
  | { type: "page.changed"; fields: FieldChange[] }
  | {
      type: "block.added";
      blockId: string;
      parentId: string | null;
      afterId: string | null;
      node: JSONContent;
    }
  | {
      type: "block.removed";
      blockId: string;
      parentId: string | null;
      node: JSONContent;
    }
  | { type: "block.changed"; blockId: string; fields: FieldChange[] }
  | {
      type: "block.moved";
      blockId: string;
      parentId: string | null;
      afterId: string | null;
    };

export interface PageDiff {
  baseRevision?: string;
  currentRevision?: string;
  projectId: string;
  pageId: string;
  baseHash: string;
  currentHash: string;
  changed: boolean;
  changes: PageChange[];
}

export type CoreErrorCode =
  | "SNAPSHOT_EXPIRED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "MISSING_BASELINE"
  | "INVALID_PATH"
  | "INVALID_DATA"
  | "LOCKED"
  | "SOURCE_UNAVAILABLE"
  | "READ_ONLY"
  | "CONFIRMATION_REQUIRED"
  | "IN_USE";

export class CoreError extends Error {
  readonly code: CoreErrorCode;
  readonly currentHash?: string;
  readonly currentRevision?: string;
  readonly conflictId?: string;
  details?: Record<string, unknown>;
  nextStep?: string;
  saveFailed?: boolean;
  recovery?: {
    action: "read-compare-save";
    projectId?: string;
    pageId?: string;
    baseRevision?: string;
  };

  constructor(
    code: CoreErrorCode,
    message: string,
    details: {
      currentHash?: string;
      currentRevision?: string;
      conflictId?: string;
    } = {},
  ) {
    super(message);
    this.name = "CoreError";
    this.code = code;
    this.currentHash = details.currentHash;
    this.currentRevision = details.currentRevision;
    this.conflictId = details.conflictId;
  }
}

export type IntegrityProblem = "database" | "content" | "history" | "repository";
export function integrityError(kind: IntegrityProblem, message: string) {
  const error = new CoreError("INVALID_DATA", message);
  error.details = { integrity: kind };
  return error;
}

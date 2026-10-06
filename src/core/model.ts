import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { NodeLayout, SavedView } from "../surface/types";

export type { ShowArtifact, ShowDocument } from "../types";
export type { JSONContent } from "@tiptap/core";

export interface ProjectBinding {
  harness: string;
  sessionId: string;
  sourceDirectory?: string;
}

export interface ProjectMetadata {
  format: "showai-project";
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Canonical host project directory, shared by all Agent sessions in it. */
  sourceDirectory?: string;
  binding?: ProjectBinding;
  bindings?: ProjectBinding[];
  pinned?: boolean;
  archived?: boolean;
  folders?: FolderMetadata[];
}

export interface FolderMetadata {
  id: string;
  name: string;
  parentId: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends ProjectMetadata {
  pageCount: number;
}

export interface ProjectGroup {
  id: string;
  name: string;
}

export interface SidebarOrganization {
  groups: ProjectGroup[];
  projectGroups: Record<string, string>;
}

export interface PageRecord {
  revision?: string;
  document: ShowDocument;
  hash: string;
  path: string;
}

export interface PageSummary {
  revision?: string;
  id: string;
  title: string;
  updatedAt: string;
  icon: string;
  hash: string;
  blockCount: number;
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
  >
>;

/** A null parent identifies the document root; omitted afterId appends. */
export type PageOperation =
  | {
      type: "component.insert";
      kind: string;
      data: Record<string, unknown>;
      parentId?: string | null;
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
  | { type: "block.text.set"; blockId: string; text: string };

export interface ApplyPageInput {
  baseRevision?: string;
  baseHash: string;
  operations: PageOperation[];
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
  | "NOT_FOUND"
  | "CONFLICT"
  | "MISSING_BASELINE"
  | "INVALID_PATH"
  | "INVALID_DATA"
  | "LOCKED";

export class CoreError extends Error {
  readonly code: CoreErrorCode;
  readonly currentHash?: string;
  readonly currentRevision?: string;

  constructor(
    code: CoreErrorCode,
    message: string,
    details: { currentHash?: string; currentRevision?: string } = {},
  ) {
    super(message);
    this.name = "CoreError";
    this.code = code;
    this.currentHash = details.currentHash;
    this.currentRevision = details.currentRevision;
  }
}

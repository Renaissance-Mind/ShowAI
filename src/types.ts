import type { JSONContent } from "@tiptap/core";
import type {
  CompiledComponent,
  PackageRevisionRef,
} from "./contract/types";
import type { PublishedComponentLocator } from "./portable/publication-types";
import type { NodeLayout, PageViews } from "./document/types";

export interface ShowPage {
  id: string;
  title: string;
  icon: string;
  cover: string;
  parentId: string | null;
  favorite: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  content: JSONContent;
  layout?: Record<string, NodeLayout>;
  views?: PageViews;
  surfaceViews?: Record<string, PageViews>;
  templateContext?: {
    format: 1;
    system: PackageRevisionRef;
    templates: PackageRevisionRef[];
  };
  comments: PageComment[];
}

export interface CommentAuthor {
  kind: "person" | "agent";
  name?: string;
  id?: string;
}
export interface CommentAnchor {
  blockId: string;
  quote?: string;
  prefix?: string;
  suffix?: string;
  start?: number;
}
export interface PageComment {
  id: string;
  text: string;
  createdAt: string;
  resolved: boolean;
  threadId?: string;
  anchor?: CommentAnchor;
  author?: CommentAuthor;
  editedAt?: string;
}
export type ShowDocument = ShowPage;
export interface WhiteboardPage extends ShowPage {
  content: JSONContent & { type: "surface" };
  layout: Record<string, NodeLayout>;
  views: PageViews;
}

export interface ShowArtifact {
  format: "showai";
  version: 1 | 2 | 3;
  document: ShowDocument;
  presentation?: "spatial" | "reading";
  selection?: { blockIds: string[]; chrome?: "none" };
  components?: CompiledComponent[];
  remoteComponents?: PublishedComponentLocator[];
  references?: import("./portable/reference-snapshot.mjs").ReferenceSnapshot;
}

export type WidgetData = Record<string, unknown>;

export interface ContainerDocument extends ShowPage {
  content: JSONContent & { type: "surface" };
  layout: Record<string, NodeLayout>;
  surfaceViews: Record<string, PageViews>;
}

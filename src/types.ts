import type { JSONContent } from "@tiptap/core";
import type {
  CompiledComponent,
  PackageRevisionRef,
} from "./components/custom/types";
import type { PublishedComponentLocator } from "./portable/publication-types";
import type { NodeLayout, PageViews } from "./surface/types";

export interface ShowPage {
  id: string;
  title: string;
  /** Text/Emoji, an HTTP(S) image URL, or embedded raster image data. */
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
  /** Exact workflow templates used by this page; rendering does not execute their guides. */
  templateContext?: {
    format: 1;
    system: PackageRevisionRef;
    templates: PackageRevisionRef[];
  };
  comments: PageComment[];
}

/** Who wrote a comment: the local person (sync account or settings name) or an Agent. */
export interface CommentAuthor {
  kind: "person" | "agent";
  name?: string;
  /** Sync account id of a person, when signed in. */
  id?: string;
}
/** A whole block when `quote` is absent; otherwise the quoted text inside that text block. */
export interface CommentAnchor {
  blockId: string;
  quote?: string;
  prefix?: string;
  suffix?: string;
  /** Offset of the quote when it was anchored; breaks ties between repeats. */
  start?: number;
}
/**
 * One comment. A thread is a comment without `threadId` (it holds the anchor
 * and the resolved state) plus the replies naming it. Comments without an
 * anchor belong to the page as a whole.
 */
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
/** Wire/API compatibility name; a page may hold a legacy doc or a v2 surface. */
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
  /** This artifact contains a projection of the source page, not the whole page.
   * chrome "none" shows the blocks as conversation components without reader options. */
  selection?: { blockIds: string[]; chrome?: "none" };
  components?: CompiledComponent[];
  /** Exact published packages required by an intentionally network-dependent export. */
  remoteComponents?: PublishedComponentLocator[];
}

export type WidgetData = Record<string, unknown>;

export interface ContainerDocument extends ShowPage {
  content: JSONContent & { type: "surface" };
  layout: Record<string, NodeLayout>;
  surfaceViews: Record<string, PageViews>;
}

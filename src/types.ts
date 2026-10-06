import type { JSONContent } from "@tiptap/core";
import type { CompiledComponent } from "./components/custom/types";
import type { PublishedComponentLocator } from "./portable/publication-types";
import type { NodeLayout, PageViews } from "./surface/types";

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
  comments: {
    id: string;
    text: string;
    createdAt: string;
    resolved: boolean;
  }[];
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
  version: 1 | 2;
  document: ShowDocument;
  presentation?: "spatial" | "reading";
  components?: CompiledComponent[];
  /** Exact published packages required by an intentionally network-dependent export. */
  remoteComponents?: PublishedComponentLocator[];
}

export type WidgetData = Record<string, unknown>;

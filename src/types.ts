import type { JSONContent } from "@tiptap/core";
import type { CompiledComponent } from "./components/custom/types";
import type { PublishedComponentLocator } from "./portable/publication-types";

export interface ShowDocument {
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
  comments: {
    id: string;
    text: string;
    createdAt: string;
    resolved: boolean;
  }[];
}

export interface ShowArtifact {
  format: "showai";
  version: 1;
  document: ShowDocument;
  components?: CompiledComponent[];
  /** Exact published packages required by an intentionally network-dependent export. */
  remoteComponents?: PublishedComponentLocator[];
}

export type WidgetData = Record<string, unknown>;

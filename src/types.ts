import type { JSONContent } from "@tiptap/core";

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

export interface Workspace {
  version: 1;
  documents: ShowDocument[];
  activeId: string;
  theme: "light" | "dark" | "system";
  font: "sans" | "serif" | "mono";
  wide: boolean;
}

export interface ShowArtifact {
  format: "showai";
  version: 1;
  document: ShowDocument;
}

export type WidgetData = Record<string, unknown>;

import { createContext, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import type { LibraryContextMenuItem } from "../ui/LibraryContextMenu";

export interface CommentSlots {
  text(editor: Editor, close: () => void): ReactNode;
  block(id: unknown, close: () => void): ReactNode;
  dock(ids: string[]): ReactNode;
  menu(ids: string[]): LibraryContextMenuItem;
}
export const CommentSlots = createContext<CommentSlots | null>(null);

import { createContext, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import type { LibraryContextMenuItem } from "../ui/LibraryContextMenu";

/** Comment actions joined to existing menus. Provided by the workbench editor; absent in readers and exports. */
export interface CommentSlots {
  /** Rich-text selection menu. */
  text(editor: Editor, close: () => void): ReactNode;
  /** A page block's handle menu. */
  block(id: unknown, close: () => void): ReactNode;
  /** Board selection toolbar. */
  dock(ids: string[]): ReactNode;
  /** Board right-click menu. */
  menu(ids: string[]): LibraryContextMenuItem;
}
export const CommentSlots = createContext<CommentSlots | null>(null);

import { createContext, type ReactNode } from "react";
import type { useComponentCatalog } from "../useComponentCatalog";
import type { CompiledComponent } from "../../contract/types";
import type { BlockProps } from "../blocks/types";
import { translator } from "../../i18n";
import messages from "../../i18n/messages/richText";

const t = translator(messages);
export const BlockMenuExtensionContext = createContext<
  ((blockId: string, close: () => void) => ReactNode) | null
>(null);
export interface AssistantRequest {
  kind: "text" | "blocks";
  blockIds: string[];
  text?: string;
  anchor: { left: number; top: number; bottom: number };
  prompt?: string;
}
export interface LinkablePage {
  id: string;
  title: string;
  icon?: string;
  updatedAt?: string;
}
export interface RecordPeekTarget {
  projectId: string;
  pageId: string;
  recordId?: string;
}
export interface RecordPeekRequest extends RecordPeekTarget {
  sourceId: string;
  records: RecordPeekTarget[];
  title?: string;
}
export interface RecordPeekState extends RecordPeekTarget {
  sourceId: string;
  propertiesHost: HTMLElement | null;
}
export interface PageLinkBridge {
  projectId: string;
  pageId: string;
  readonly pages: LinkablePage[];
  subscribePages?(listener: () => void): () => void;
  copyLink(blockIds: string[]): void;
  createPage?(input: {
    title?: string;
    folderId?: string;
    folderName: string;
  }): Promise<{ pageId: string; folderId: string }>;
  renamePage?(pageId: string, title: string): Promise<void>;
  openRecord?(request: RecordPeekRequest): void;
  closeRecord?(sourceId: string): void;
  recordPeek?: RecordPeekState;
}
export const RichTextEnvironment = createContext<{
  useCatalog: typeof useComponentCatalog;
  registerComponent: (component: CompiledComponent) => void;
  renderWidget: (props: BlockProps & { kind: string }) => ReactNode;
  validateWidget?: (kind: string, data: Record<string, unknown>) => void;
  assistant?: {
    referenceLabel?: string;
    open: (request: AssistantRequest) => void;
    reference: (request: AssistantRequest) => void;
  } | null;
  pageLinks?: PageLinkBridge | null;
  comments?: {
    text(editor: import("@tiptap/core").Editor, close: () => void): ReactNode;
    block(id: unknown, close: () => void): ReactNode;
  } | null;
}>({
  useCatalog: () => ({
    items: [],
    loading: false,
    error: "",
    displayName: (item) => item.name,
    displayDescription: (item) => item.description,
    resolve: async () => {
      throw Error("No component library is connected.");
    },
  }),
  registerComponent: () => {
    throw Error("No component library is connected.");
  },
  renderWidget: ({ kind }) => (
    <span role="status">{t("noComponentHost", { kind })}</span>
  ),
});

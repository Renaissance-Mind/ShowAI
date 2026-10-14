import { createContext, type ReactNode } from "react";
import type { useComponentCatalog } from "../useComponentCatalog";
import type { CompiledComponent } from "../custom/types";
import type { BlockProps } from "../blocks/types";
import { translator } from "../../i18n";
import messages from "../../i18n/messages/richText";

const t = translator(messages);
/** What an editor hands to the workbench Agent: stable block ids, optional text and an anchor rect. */
export interface AssistantRequest {
  kind: "text" | "blocks";
  blockIds: string[];
  text?: string;
  anchor: { left: number; top: number; bottom: number };
}
/** The host supplies project resources; all writing tools belong to the component. */
export const RichTextEnvironment = createContext<{
  useCatalog: typeof useComponentCatalog;
  registerComponent: (component: CompiledComponent) => void;
  renderWidget: (props: BlockProps & { kind: string }) => ReactNode;
  /** Present only inside an editable workbench page with an Agent available. */
  assistant?: { open: (request: AssistantRequest) => void } | null;
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

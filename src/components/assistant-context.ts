import { createContext } from "react";
import type { AssistantRequest } from "./rich-text/environment";
import type { ComponentContextSnapshot } from "../contract/component-context.mjs";

export type { AssistantRequest };
export type AssistantAnchor = AssistantRequest["anchor"];
export type AssistantTarget = (
  | AssistantRequest
  | {
      kind: "board";
      blockIds: string[];
      surfaceId?: string;
      anchor: AssistantAnchor;
    }
  | { kind: "page"; anchor?: AssistantAnchor; prompt?: string }
) & { reference?: import("../surface/agent-reference").CanvasReference };
export interface ComponentContextItem extends ComponentContextSnapshot {
  blockId: string;
  componentId?: string;
  name: string;
}
export interface AssistantBridge {
  open(target: AssistantTarget): void;
  reference(target: AssistantTarget): void;
  componentContext(item: ComponentContextItem): void;
  pendingComponentContext(
    blockId: string,
  ): ComponentContextSnapshot | undefined;
}
export const AssistantContext = createContext<AssistantBridge | null>(null);

import { createContext } from "react";
import type { AssistantRequest } from "./rich-text/environment";

export type { AssistantRequest };
export type AssistantAnchor = AssistantRequest["anchor"];
/** Text and blocks come from editors; board selections and the page from workbench menus. */
export type AssistantTarget = (
  | AssistantRequest
  | {
      kind: "board";
      blockIds: string[];
      surfaceId?: string;
      anchor: AssistantAnchor;
    }
  | { kind: "page"; anchor?: AssistantAnchor }
) & { reference?: import("../surface/agent-reference").CanvasReference };
export interface AssistantBridge {
  open(target: AssistantTarget): void;
}
/** Provided by the workbench around the editable page; absent in readers and exports. */
export const AssistantContext = createContext<AssistantBridge | null>(null);

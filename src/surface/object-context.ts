import { createContext } from "react";
import type { NodeLayout } from "../document/types";
import type { SurfaceGeometryStore } from "./geometry-store";
import type { BoardInteraction } from "./useBoardInteraction";

export interface ObjectActions {
  componentActionsHost?: HTMLElement | null;
  nativeScene?: boolean;
  scale: number;
  geometry?: SurfaceGeometryStore;
  selected: string | null;
  board?: BoardInteraction;
  connect?: (
    id: string,
    endpoint: "start" | "end",
    point: { x: number; y: number },
  ) => void;
  select: (id: string | null, additive?: boolean) => void;
  highlightTarget?: (x: number | null, y?: number, exclude?: string) => void;
  inspect?: (id: string | null) => void;
  expand?: (id: string) => void;
  remove?: (id: string) => void;
  move?: (id: string, frame: NodeLayout) => void;
  labelEditing?: string | null;
  editLabel?: (id: string | null) => void;
  setLabel?: (id: string, label: string, minHeight?: number) => void;
  readOnly: boolean;
  revealAll: boolean;
  revealed: Set<string>;
}
export const ObjectContext = createContext<ObjectActions>({
  scale: 1,
  selected: null,
  select: () => {},
  readOnly: true,
  revealAll: false,
  revealed: new Set(),
});

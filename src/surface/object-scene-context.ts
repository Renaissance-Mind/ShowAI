import { createContext } from "react";
import type { SurfaceGeometryStore } from "./geometry-store";

/**
 * The part of the object context that content nodes read. It is provided next
 * to ObjectContext and does not change with selection, so selecting an object
 * re-renders object chrome without re-rendering every object's content.
 */
export interface ObjectScene {
  /** This exact Board has an accepted native scene owning paint and selection. */
  nativeScene?: boolean;
  geometry?: SurfaceGeometryStore;
  readOnly: boolean;
}
export const ObjectSceneContext = createContext<ObjectScene>({ readOnly: true });

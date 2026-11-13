import * as datasets from "./datasets";
import * as pages from "./pages";
import type { Operation } from "./operation";

const isOperation = (value: unknown): value is Operation =>
  !!value &&
  typeof value === "object" &&
  "id" in value &&
  "run" in value &&
  "input" in value;

/** Every shared operation, by domain module. */
export const OPERATIONS: readonly Operation[] = [pages, datasets].flatMap(
  (domain) => Object.values(domain).filter(isOperation),
);

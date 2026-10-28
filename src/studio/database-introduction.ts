import type { JSONContent } from "@tiptap/core";
import { validateProjectDatabaseIntroduction } from "../core/project-database-introduction";
import { equalValues, type DatasetOperation } from "../datasets/operations.mjs";

/** Touch only the introduction; document properties and view settings remain independent. */
export function databaseIntroductionOperations(
  next: JSONContent,
  before: JSONContent | undefined,
): DatasetOperation[] {
  validateProjectDatabaseIntroduction(next);
  if (equalValues(next, before)) return [];
  return [
    {
      op: "set",
      path: ["intro"],
      value: next,
      ...(before === undefined ? { absent: true as const } : { before }),
    },
  ];
}

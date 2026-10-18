import { randomUUID } from "node:crypto";
import { remapSurfaceIds } from "../surface/document.mjs";
import { validateDocument } from "../portable/validation.mjs";
import type { ShowDocument } from "./model";
const documentCopy = (document: ShowDocument) =>
  validateDocument(JSON.parse(JSON.stringify(document))) as ShowDocument;
export function instantiateTemplate(document: ShowDocument): ShowDocument {
  const copy = remapSurfaceIds(documentCopy(document), randomUUID),
    date = new Date().toISOString();
  return {
    ...copy,
    id: randomUUID(),
    createdAt: date,
    updatedAt: date,
    favorite: false,
    archived: false,
    parentId: null,
    comments: [],
  };
}

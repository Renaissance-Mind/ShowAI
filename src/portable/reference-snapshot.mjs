// The references of an exported page, written by the export so components that
// read references show them in the reader. Dependency-free: it runs in readers.

export const REFERENCE_SNAPSHOT_LIMIT = 200;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const KINDS = ["link", "database", "component"];

function text(value, path, max) {
  if (typeof value !== "string" || value.length > max)
    throw new Error(`${path} must be text of at most ${max} characters.`);
  return value;
}
function item(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object.`);
  if (!ID.test(value.projectId) || !ID.test(value.pageId))
    throw new Error(`${path} needs projectId and pageId.`);
  if (value.blockId !== null && !ID.test(value.blockId))
    throw new Error(`${path}.blockId must be a block ID or null.`);
  if (
    !Array.isArray(value.blockIds) ||
    value.blockIds.length > 100 ||
    !value.blockIds.every((id) => ID.test(id))
  )
    throw new Error(`${path}.blockIds must list block IDs.`);
  if (!KINDS.includes(value.kind))
    throw new Error(`${path}.kind must be ${KINDS.join(", ")}.`);
  return {
    projectId: value.projectId,
    pageId: value.pageId,
    title: text(value.title, `${path}.title`, 1000),
    ...(value.icon !== undefined
      ? { icon: text(value.icon, `${path}.icon`, 4000) }
      : {}),
    blockId: value.blockId,
    blockIds: [...value.blockIds],
    kind: value.kind,
    snippet: text(value.snippet, `${path}.snippet`, 1000),
    ...(value.missing === true ? { missing: true } : {}),
  };
}

/** The checked snapshot; throws with the field path when it is invalid. */
export function validateReferenceSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("references must be an object.");
  const page = value.page;
  if (!page || !ID.test(page.projectId) || !ID.test(page.pageId))
    throw new Error("references.page needs projectId and pageId.");
  const list = (key) => {
    const items = value[key];
    if (!Array.isArray(items) || items.length > REFERENCE_SNAPSHOT_LIMIT)
      throw new Error(
        `references.${key} must list at most ${REFERENCE_SNAPSHOT_LIMIT} references.`,
      );
    return items.map((entry, index) => item(entry, `references.${key}[${index}]`));
  };
  // Distinct pages in each direction; the lists may stop at the limit.
  let pages;
  if (value.pages !== undefined) {
    if (!value.pages || typeof value.pages !== "object")
      throw new Error("references.pages must be {to, from}.");
    for (const key of ["to", "from"])
      if (!Number.isInteger(value.pages[key]) || value.pages[key] < 0)
        throw new Error(`references.pages.${key} must be a count.`);
    pages = { to: value.pages.to, from: value.pages.from };
  }
  return {
    page: { projectId: page.projectId, pageId: page.pageId },
    to: list("to"),
    from: list("from"),
    ...(pages ? { pages } : {}),
  };
}

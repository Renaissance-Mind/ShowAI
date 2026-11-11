// Data contracts of the date and backlinks components. Dependency-free: the
// workbench, CLI and MCP saves and the offline reader all run them.

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const isObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** A calendar day; `date` is YYYY-MM-DD. */
export function validateDateData(data) {
  if (!isObject(data)) throw new Error("Date data must be an object.");
  for (const key of Object.keys(data))
    if (key !== "date") throw new Error(`Date data does not take ${key}.`);
  const match = typeof data.date === "string" ? DAY.exec(data.date) : null;
  const day =
    match && new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  if (
    !match ||
    day.getUTCFullYear() !== +match[1] ||
    day.getUTCMonth() !== +match[2] - 1 ||
    day.getUTCDate() !== +match[3]
  )
    throw new Error("date must be a YYYY-MM-DD calendar day.");
  return data;
}

/** Backlinks of the page holding the block, or of the page it names. */
export function validateBacklinksData(data) {
  if (!isObject(data)) throw new Error("Backlinks data must be an object.");
  for (const key of Object.keys(data))
    if (!["title", "pageId", "projectId"].includes(key))
      throw new Error(`Backlinks data does not take ${key}.`);
  if (
    data.title !== undefined &&
    (typeof data.title !== "string" || data.title.length > 200)
  )
    throw new Error("title must be text of at most 200 characters.");
  for (const key of ["pageId", "projectId"])
    if (
      data[key] !== undefined &&
      (typeof data[key] !== "string" || !ID.test(data[key]))
    )
      throw new Error(`${key} must be a page or project ID.`);
  if (data.projectId !== undefined && data.pageId === undefined)
    throw new Error("projectId needs pageId.");
  return data;
}

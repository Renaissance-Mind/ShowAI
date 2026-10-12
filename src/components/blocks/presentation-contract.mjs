const fail = (message) => {
  throw new Error(message);
};
function string(value, label) {
  if (typeof value !== "string" || !value.trim())
    fail(`${label} must be non-empty text.`);
}
function items(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum)
    fail(`${label} must be an array of at most ${maximum} items.`);
  const ids = new Set();
  for (const item of value) {
    if (!item || typeof item !== "object")
      fail(`${label} contains an invalid item.`);
    string(item.id, `${label}.id`);
    if (ids.has(item.id)) fail(`${label} contains duplicate id ${item.id}.`);
    ids.add(item.id);
  }
  return ids;
}
function sources(value = []) {
  if (!Array.isArray(value)) fail("sources must be an array.");
  for (const source of value) {
    string(source.label, "source.label");
    if (!/^https?:\/\//i.test(source.url))
      fail("Sources require an http(s) URL.");
  }
}
export function validatePresentationData(kind, data) {
  if (!data || typeof data !== "object")
    fail("Presentation data must be an object.");
  string(data.title, "title");
  if (kind === "mechanism-steps") {
    const partIds = items(data.parts, "parts", 8);
    for (const part of data.parts) string(part.label, "part.label");
    items(data.frames, "frames", 16);
    for (const frame of data.frames) {
      string(frame.title, "frame.title");
      string(frame.explanation, "frame.explanation");
      const states = items(frame.states, "states", 8);
      if (
        states.size !== partIds.size ||
        [...states].some((id) => !partIds.has(id))
      )
        fail("Each frame must describe every stable part exactly once.");
      for (const state of frame.states) {
        string(state.value, "state.value");
        if (!["changed", "retained", "fixed"].includes(state.status))
          fail("State status must be changed, retained or fixed.");
      }
      if (!Array.isArray(frame.links)) fail("frame.links must be an array.");
      for (const link of frame.links) {
        if (!partIds.has(link.from) || !partIds.has(link.to))
          fail("Mechanism links must point to existing parts.");
        string(link.label, "link.label");
      }
      sources(frame.sources);
    }
  } else if (kind === "evidence-explorer") {
    const dimensionIds = items(data.dimensions, "dimensions", 8);
    for (const dimension of data.dimensions)
      string(dimension.label, "dimension.label");
    items(data.items, "items", 80);
    for (const item of data.items) {
      for (const key of ["title", "category", "claim", "boundary"])
        string(item[key], `item.${key}`);
      if (item.date && !/^\d{4}-\d{2}(?:-\d{2})?$/.test(item.date))
        fail("date must be YYYY-MM or YYYY-MM-DD.");
      if (item.date) string(item.dateLabel, "item.dateLabel");
      if (
        !item.values ||
        typeof item.values !== "object" ||
        Array.isArray(item.values)
      )
        fail("item.values must be an object.");
      for (const [key, value] of Object.entries(item.values)) {
        if (!dimensionIds.has(key))
          fail(`Unknown comparison dimension ${key}.`);
        string(value, `values.${key}`);
      }
      sources(item.sources);
    }
  } else fail(`Unknown presentation component ${kind}.`);
}

export function selectEvidence(items, category = "", query = "") {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter(
    (item) =>
      (!category || item.category === category) &&
      (!needle ||
        [item.title, item.claim, item.boundary, ...Object.values(item.values)]
          .join(" ")
          .toLocaleLowerCase()
          .includes(needle)),
  );
}

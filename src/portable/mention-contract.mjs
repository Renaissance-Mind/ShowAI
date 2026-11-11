// A component that declares `mention` in its contract appears in the @ menu
// of rich text and is placed inside the line. The menu fills one string prop:
// `input: "date"` offers today, tomorrow and typed dates (YYYY-MM-DD),
// `input: "text"` offers what was typed, and `options` are fixed choices.
// Shared by the catalog, component saves and the editor; no dependencies.

export const MENTION_INPUTS = ["date", "text", "options"];
const PROP = /^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/;

/** The checked contract; throws with the field path when it is invalid. */
export function validateMentionContract(value, schema) {
  const fail = (message) => {
    throw new Error(`mention${message}`);
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(" must be an object.");
  for (const key of Object.keys(value))
    if (!["prop", "input", "options"].includes(key))
      fail(` does not take ${key}.`);
  if (typeof value.prop !== "string" || !PROP.test(value.prop))
    fail(".prop must name a top-level prop.");
  if (!MENTION_INPUTS.includes(value.input))
    fail(`.input must be one of ${MENTION_INPUTS.join(", ")}.`);
  if (value.options !== undefined) {
    if (!Array.isArray(value.options) || value.options.length > 50)
      fail(".options must be an array of at most 50 choices.");
    value.options.forEach((option, index) => {
      if (
        !option ||
        typeof option !== "object" ||
        typeof option.label !== "string" ||
        !option.label.trim() ||
        option.label.length > 200 ||
        typeof option.value !== "string" ||
        option.value.length > 1000 ||
        (option.keywords !== undefined &&
          (typeof option.keywords !== "string" ||
            option.keywords.length > 500)) ||
        Object.keys(option).some(
          (key) => !["label", "value", "keywords"].includes(key),
        )
      )
        fail(`.options[${index}] needs label and value text (and optional keywords).`);
    });
  }
  if (value.input === "options" && !value.options?.length)
    fail(' with input "options" needs options.');
  if (schema !== undefined) {
    const field = schema?.properties?.[value.prop];
    const type = field?.type;
    if (
      !field ||
      !(type === "string" || (Array.isArray(type) && type.includes("string")))
    )
      fail(".prop must be a string property of the props schema.");
  }
  return value;
}

/** YYYY-MM-DD of a local calendar day. */
export function isoDay(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Days a typed query names: an ISO day, a numeric month/day (with or without
 * year), or nothing. Relative words are matched by the menu's own labels.
 */
export function typedDays(query, today = new Date()) {
  const text = query.trim();
  const valid = (year, month, day) => {
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
      ? isoDay(date)
      : null;
  };
  let match = /^(\d{4})[-/.\u5e74](\d{1,2})[-/.\u6708](\d{1,2})\u65e5?$/.exec(text);
  if (match) {
    const day = valid(+match[1], +match[2], +match[3]);
    return day ? [day] : [];
  }
  match = /^(\d{1,2})[-/.\u6708](\d{1,2})\u65e5?$/.exec(text);
  if (match) {
    const day = valid(today.getFullYear(), +match[1], +match[2]);
    return day ? [day] : [];
  }
  return [];
}

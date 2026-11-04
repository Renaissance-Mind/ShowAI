// Contract for the mechanism-diagram built-in: objects on a grid, the state
// they hold (small tables), the links between them, and steps that change only
// what differs. Dependency-free so the workbench, CLI and reader share it.

import { DRAWING_TONES } from "./svg-contract.mjs";

const fail = (message) => {
  throw new Error(message);
};
const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export { DRAWING_TONES };
export const MECHANISM_LIMITS = {
  nodes: 60,
  zones: 12,
  links: 120,
  marks: 60,
  steps: 12,
  grid: 20,
  span: 8,
  columns: 4,
  rows: 12,
  text: 400,
  cell: 80,
};
export const LINK_STYLES = ["solid", "dashed"];
export const LINK_ENDS = ["end", "both", "none"];
export const LINK_WEIGHTS = ["thin", "normal", "thick"];
export const SIDES = ["top", "right", "bottom", "left"];
export const MARK_KINDS = ["check", "cross"];

function text(value, label, max = MECHANISM_LIMITS.text) {
  if (typeof value !== "string" || !value.trim())
    fail(`${label} must be non-empty text.`);
  if (value.length > max) fail(`${label} must be at most ${max} characters.`);
}
function optionalText(value, label, max) {
  if (value !== undefined) text(value, label, max);
}
function list(value, label, maximum, minimum = 0) {
  if (value === undefined && minimum === 0) return [];
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    fail(`${label} must be an array of ${minimum} to ${maximum} items.`);
  value.forEach((item, index) => {
    if (!isObject(item)) fail(`${label}[${index}] must be an object.`);
  });
  return value;
}
function oneOf(value, allowed, label) {
  if (value !== undefined && !allowed.includes(value))
    fail(`${label} must be one of ${allowed.join(", ")}.`);
}
function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max)
    fail(`${label} must be an integer from ${min} to ${max}.`);
}
function optionalInteger(value, label, min, max) {
  if (value !== undefined) integer(value, label, min, max);
}
function place(item, label) {
  integer(item.col, `${label}.col`, 0, MECHANISM_LIMITS.grid - 1);
  integer(item.row, `${label}.row`, 0, MECHANISM_LIMITS.grid - 1);
  optionalInteger(item.colSpan, `${label}.colSpan`, 1, MECHANISM_LIMITS.span);
  optionalInteger(item.rowSpan, `${label}.rowSpan`, 1, MECHANISM_LIMITS.span);
}
function rows(value, label, width) {
  const items = Array.isArray(value)
    ? value
    : fail(`${label} must be an array.`);
  if (items.length > MECHANISM_LIMITS.rows)
    fail(`${label} must have at most ${MECHANISM_LIMITS.rows} rows.`);
  items.forEach((row, index) => {
    if (
      !Array.isArray(row) ||
      row.length < 1 ||
      row.length > MECHANISM_LIMITS.columns ||
      (width && row.length !== width)
    )
      fail(
        `${label}[${index}] must be a row of ${width ? width : `1 to ${MECHANISM_LIMITS.columns}`} cells.`,
      );
    row.forEach((cell, at) => {
      if (typeof cell !== "string" || cell.length > MECHANISM_LIMITS.cell)
        fail(
          `${label}[${index}][${at}] must be text of at most ${MECHANISM_LIMITS.cell} characters.`,
        );
    });
  });
}
function table(value, label) {
  if (!isObject(value)) fail(`${label} must be an object.`);
  optionalText(value.title, `${label}.title`);
  optionalText(value.empty, `${label}.empty`);
  let width;
  if (value.columns !== undefined) {
    if (
      !Array.isArray(value.columns) ||
      value.columns.length < 1 ||
      value.columns.length > MECHANISM_LIMITS.columns
    )
      fail(
        `${label}.columns must list 1 to ${MECHANISM_LIMITS.columns} headings.`,
      );
    value.columns.forEach((heading, index) =>
      text(heading, `${label}.columns[${index}]`, MECHANISM_LIMITS.cell),
    );
    width = value.columns.length;
  }
  rows(value.rows ?? [], `${label}.rows`, width);
  return width;
}
function stepRefs(value, label, steps) {
  if (value === undefined) return;
  if (!steps.size) fail(`${label} needs steps; the diagram has none.`);
  if (!Array.isArray(value) || !value.length)
    fail(`${label} must list step ids.`);
  value.forEach((id, index) => {
    if (!steps.has(id))
      fail(`${label}[${index}] references a missing step ${id}.`);
  });
}

export function validateMechanismData(data) {
  if (!isObject(data)) fail("mechanism-diagram data must be an object.");
  optionalText(data.title, "title");
  optionalText(data.description, "description", 2000);
  const steps = new Set();
  list(data.steps, "steps", MECHANISM_LIMITS.steps).forEach((step, index) => {
    text(step.id, `steps[${index}].id`, 80);
    if (steps.has(step.id)) fail(`steps[${index}] duplicates id ${step.id}.`);
    steps.add(step.id);
  });
  const nodes = new Map();
  const ids = new Set();
  const claim = (id, label) => {
    text(id, label, 80);
    if (ids.has(id)) fail(`${label} duplicates id ${id}.`);
    ids.add(id);
  };
  list(data.nodes, "nodes", MECHANISM_LIMITS.nodes, 1).forEach(
    (node, index) => {
      const label = `nodes[${index}]`;
      claim(node.id, `${label}.id`);
      place(node, label);
      oneOf(node.tone, DRAWING_TONES, `${label}.tone`);
      if (node.table === undefined) text(node.label, `${label}.label`);
      else optionalText(node.label, `${label}.label`);
      optionalText(node.sub, `${label}.sub`);
      optionalText(node.note, `${label}.note`, 1000);
      const width =
        node.table === undefined
          ? undefined
          : table(node.table, `${label}.table`);
      stepRefs(node.in, `${label}.in`, steps);
      nodes.set(node.id, { table: node.table !== undefined, width });
    },
  );
  list(data.zones, "zones", MECHANISM_LIMITS.zones).forEach((zone, index) => {
    const label = `zones[${index}]`;
    claim(zone.id, `${label}.id`);
    place(zone, label);
    optionalText(zone.label, `${label}.label`);
    oneOf(zone.tone, DRAWING_TONES, `${label}.tone`);
  });
  const links = new Set();
  list(data.links, "links", MECHANISM_LIMITS.links).forEach((link, index) => {
    const label = `links[${index}]`;
    claim(link.id, `${label}.id`);
    for (const end of ["from", "to"])
      if (!nodes.has(link[end]))
        fail(`${label}.${end} references a missing node ${link[end]}.`);
    if (link.from === link.to)
      fail(`${label} must connect two different nodes.`);
    optionalText(link.label, `${label}.label`, 120);
    oneOf(link.tone, DRAWING_TONES, `${label}.tone`);
    oneOf(link.style, LINK_STYLES, `${label}.style`);
    oneOf(link.ends, LINK_ENDS, `${label}.ends`);
    oneOf(link.weight, LINK_WEIGHTS, `${label}.weight`);
    oneOf(link.fromSide, SIDES, `${label}.fromSide`);
    oneOf(link.toSide, SIDES, `${label}.toSide`);
    stepRefs(link.in, `${label}.in`, steps);
    links.add(link.id);
  });
  list(data.marks, "marks", MECHANISM_LIMITS.marks).forEach((mark, index) => {
    const label = `marks[${index}]`;
    claim(mark.id, `${label}.id`);
    if (!nodes.has(mark.on) && !links.has(mark.on))
      fail(`${label}.on references a missing node or link ${mark.on}.`);
    if (!MARK_KINDS.includes(mark.kind))
      fail(`${label}.kind must be one of ${MARK_KINDS.join(", ")}.`);
    oneOf(mark.tone, DRAWING_TONES, `${label}.tone`);
    optionalText(mark.label, `${label}.label`, 120);
    stepRefs(mark.in, `${label}.in`, steps);
  });
  (data.steps ?? []).forEach((step, index) => {
    const label = `steps[${index}]`;
    text(step.title, `${label}.title`, 80);
    optionalText(step.text, `${label}.text`, 2000);
    if (step.focus !== undefined) {
      if (!Array.isArray(step.focus) || !step.focus.length)
        fail(`${label}.focus must list node, link or mark ids.`);
      step.focus.forEach((id, at) => {
        if (!ids.has(id))
          fail(`${label}.focus[${at}] references a missing element ${id}.`);
      });
    }
    if (step.tones !== undefined) {
      if (!isObject(step.tones)) fail(`${label}.tones must be an object.`);
      for (const [id, tone] of Object.entries(step.tones)) {
        if (!ids.has(id))
          fail(`${label}.tones.${id} references a missing element.`);
        oneOf(tone, DRAWING_TONES, `${label}.tones.${id}`);
      }
    }
    if (step.labels !== undefined) {
      if (!isObject(step.labels)) fail(`${label}.labels must be an object.`);
      for (const [id, value] of Object.entries(step.labels)) {
        if (!links.has(id))
          fail(`${label}.labels.${id} references a missing link.`);
        text(value, `${label}.labels.${id}`, 120);
      }
    }
    if (step.tables !== undefined) {
      if (!isObject(step.tables)) fail(`${label}.tables must be an object.`);
      for (const [id, change] of Object.entries(step.tables)) {
        const node = nodes.get(id);
        if (!node?.table)
          fail(`${label}.tables.${id} references a node without a table.`);
        if (!isObject(change)) fail(`${label}.tables.${id} must be an object.`);
        if (change.rows !== undefined)
          rows(change.rows, `${label}.tables.${id}.rows`, node.width);
        optionalInteger(
          change.highlight,
          `${label}.tables.${id}.highlight`,
          0,
          MECHANISM_LIMITS.rows - 1,
        );
        oneOf(change.tone, DRAWING_TONES, `${label}.tables.${id}.tone`);
      }
    }
  });
  if (data.initialStep !== undefined && !steps.has(data.initialStep))
    fail(`initialStep references a missing step ${data.initialStep}.`);
  return data;
}

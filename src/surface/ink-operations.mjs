import { isInkNode, validatePortableInk } from "./portable-ink.mjs";

export const INK_OPERATION_FORMAT = "showai-ink-operation-v1";
export const INK_CHECKPOINT_FORMAT = "showai-ink-checkpoint-v1";
const attributes = ["ink", "color", "strokeWidth", "pressure"];
const fields = [...attributes, "node", "layout"];
const own = (object, key) => Object.hasOwn(object, key);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const finite = n => typeof n === "number" && Number.isFinite(n);
const id = value => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value);
const invalid = message => { throw new Error(`Invalid ink operation: ${message}`); };
const clone = value => JSON.parse(canonicalInkJSON(value));

/** Strict JSON, UTF-16 object-key order, and ECMAScript number formatting. */
export function canonicalInkJSON(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (finite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalInkJSON).join(",")}]`;
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return `{${Object.keys(value).sort(compare).map(key => `${JSON.stringify(key)}:${canonicalInkJSON(value[key])}`).join(",")}}`;
  return invalid("only finite JSON values are supported");
}

/** Synchronous SHA-256 for the same pure kernel in browsers and JavaScriptCore. */
export function inkOperationDigest(value) {
  const source = typeof value === "string" ? value : canonicalInkJSON(value), bytes = [];
  for (const ch of source) {
    const code = ch.codePointAt(0), c = code >= 0xd800 && code <= 0xdfff ? 0xfffd : code;
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | c >> 6, 0x80 | c & 63);
    else if (c < 0x10000) bytes.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    else bytes.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
  }
  const bits = bytes.length * 8;
  bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; --i) bytes.push(Math.floor(bits / 2 ** (i * 8)) & 255);
  const constants = [], initial = [];
  for (let candidate = 2; constants.length < 64; ++candidate) {
    let prime = true;
    for (let divisor = 2; divisor * divisor <= candidate; ++divisor) if (candidate % divisor === 0) { prime = false; break; }
    if (!prime) continue;
    if (initial.length < 8) initial.push(Math.floor(Math.sqrt(candidate) * 2 ** 32) >>> 0);
    constants.push(Math.floor(Math.cbrt(candidate) * 2 ** 32) >>> 0);
  }
  const rotate = (v, n) => v >>> n | v << 32 - n, words = new Int32Array(64), result = initial;
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; ++i) words[i] = bytes[offset + i * 4] << 24 | bytes[offset + i * 4 + 1] << 16 | bytes[offset + i * 4 + 2] << 8 | bytes[offset + i * 4 + 3];
    for (let i = 16; i < 64; ++i) {
      const x = words[i - 15], y = words[i - 2];
      words[i] = words[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ x >>> 3) + words[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ y >>> 10);
    }
    let [a, b, c, d, e, f, g, h] = result;
    for (let i = 0; i < 64; ++i) {
      const t1 = h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (e & f ^ ~e & g) + constants[i] + words[i];
      const t2 = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + (a & b ^ a & c ^ b & c);
      h = g; g = f; f = e; e = d + t1 | 0; d = c; c = b; b = a; a = t1 + t2 | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { result[i] = result[i] + v >>> 0; });
  }
  return result.map(n => n.toString(16).padStart(8, "0")).join("");
}

function layout(value) {
  if (!value || !finite(value.x) || !finite(value.y) || !finite(value.width) || value.width <= 0 ||
      value.height !== undefined && (!finite(value.height) || value.height <= 0) ||
      value.rotation !== undefined && !finite(value.rotation)) invalid("invalid stroke layout");
}
function field(name, value) {
  if (attributes.includes(name) && value === null) return;
  if (name === "ink") validatePortableInk(value);
  else if (name === "node" && (!value?.attrs || !id(value.attrs.id) || attributes.some(key => own(value.attrs, key)))) invalid("node metadata must exclude mutable ink attributes");
  else if (name === "layout") layout(value);
  else if (name === "color" && (!id(value) || value.length > 128)) invalid("invalid color");
  else if (name === "strokeWidth" && (!finite(value) || value < 0.5 || value > 40)) invalid("invalid stroke width");
  else if (name === "pressure" && typeof value !== "boolean") invalid("invalid pressure flag");
}

export function validateInkOperation(value) {
  canonicalInkJSON(value);
  if (value?.format !== INK_OPERATION_FORMAT || typeof value.actor !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value.actor) ||
      !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.id !== `${value.actor}:${value.sequence}` ||
      !id(value.pageId) || !id(value.boardId)) invalid("identity or version");
  if (!Array.isArray(value.parents) || new Set(value.parents).size !== value.parents.length ||
      value.parents.some(parent => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}:[1-9][0-9]*$/.test(parent) || parent === value.id)) invalid("causal parents");
  if (value.sequence > 1 && !value.parents.includes(`${value.actor}:${value.sequence - 1}`)) invalid("actor sequence must name its predecessor");
  if (!Array.isArray(value.changes) || !value.changes.length || value.changes.length > 100000) invalid("empty or excessive changes");
  const touched = new Set();
  for (const change of value.changes) {
    if (!id(change.strokeId) || touched.has(change.strokeId)) invalid("stroke identity must occur once per operation");
    touched.add(change.strokeId);
    if (change.kind === "create") {
      if (change.node?.attrs?.id !== change.strokeId || !isInkNode(change.node)) invalid("creation requires an ink node with the same stable id");
      if (change.node.attrs.ink) validatePortableInk(change.node.attrs.ink);
      layout(change.layout);
    } else if (change.kind === "edit") {
      if (!change.patch || !Object.keys(change.patch).length || Object.keys(change.patch).some(key => !fields.includes(key))) invalid("unsupported edit field");
      Object.entries(change.patch).forEach(([key, value]) => field(key, value));
      if (change.patch.node && change.patch.node.attrs.id !== change.strokeId) invalid("metadata cannot change stroke identity");
    } else if (!["delete", "restore"].includes(change.kind)) invalid("unsupported change kind");
  }
  return value;
}

export function createInkOperation({ actor, sequence, pageId, boardId, parents = [], changes }) {
  return clone(validateInkOperation({ format: INK_OPERATION_FORMAT, id: `${actor}:${sequence}`, actor, sequence, pageId, boardId, parents: [...new Set(parents)].sort(compare), changes }));
}

/** Bootstrap once from an existing Board. It does not flatten or rasterize strokes. */
export function bootstrapInkOperation({ actor, pageId, boardId, nodes, layout }) {
  if (!nodes.length) return null;
  // The same imported snapshot must have one identity on every device. Distinct
  // snapshots require an explicit baseline reconciliation, never two creations.
  actor ??= `snapshot-${inkOperationDigest({ pageId, boardId, nodes, layout: Object.fromEntries(nodes.map(node => [node.attrs.id, layout[node.attrs.id]])) }).slice(0, 48)}`;
  return createInkOperation({ actor, sequence: 1, pageId, boardId, changes: nodes.map(node => ({ kind: "create", strokeId: node.attrs.id, node, layout: layout[node.attrs.id] })) });
}

export function emptyInkCheckpoint({ pageId, boardId }) {
  if (!id(pageId) || !id(boardId)) invalid("empty checkpoint scope");
  return { format: INK_CHECKPOINT_FORMAT, pageId, boardId, frontier: [], known: {}, strokes: [] };
}
export function inkNodeMetadata(node) {
  return { ...node, attrs: Object.fromEntries(Object.entries(node.attrs).filter(([key]) => !attributes.includes(key))) };
}
const observed = (clock, operationId) => {
  const colon = operationId.lastIndexOf(":"), actor = operationId.slice(0, colon), sequence = Number(operationId.slice(colon + 1));
  return own(clock, actor) && clock[actor] >= sequence;
};

/** Checkpoints are local trusted accelerators, not self-authenticating remote
 * snapshots. Journal checksums detect corruption; remote batches replay source ops. */
export function validateInkCheckpoint(state) {
  if (state?.format !== INK_CHECKPOINT_FORMAT || !id(state.pageId) || !id(state.boardId) || !state.known || !Array.isArray(state.strokes) || !Array.isArray(state.frontier)) invalid("checkpoint");
  const known = state.known, operationIds = Object.keys(known);
  for (const operationId of operationIds) {
    const item = known[operationId], match = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,95}):([1-9][0-9]*)$/.exec(operationId);
    if (!match || !/^[a-f0-9]{64}$/.test(item.hash) || !Number.isSafeInteger(item.level) || item.level < 1 || !item.clock || item.clock[match[1]] !== Number(match[2])) invalid("checkpoint causal identity");
    for (const [actor, sequence] of Object.entries(item.clock)) if (!Number.isSafeInteger(sequence) || sequence < 1 || !own(known, `${actor}:${sequence}`)) invalid("checkpoint causal coverage");
  }
  if (new Set(state.frontier).size !== state.frontier.length || state.frontier.some(operationId => !own(known, operationId))) invalid("checkpoint frontier");
  for (const operationId of operationIds) if (!state.frontier.some(head => observed(known[head].clock, operationId))) invalid("checkpoint omits a causal head");
  for (const head of state.frontier) if (state.frontier.some(other => head !== other && observed(known[other].clock, head))) invalid("checkpoint frontier must be an antichain");
  const seen = new Set();
  for (const stroke of state.strokes) {
    if (!id(stroke.id) || seen.has(stroke.id) || !own(known, stroke.creationId) || !Array.isArray(stroke.creationOrder) || stroke.creationOrder.length !== 3 || stroke.creationOrder[0] !== known[stroke.creationId].level || stroke.creationOrder[1] !== stroke.creationId || !Number.isSafeInteger(stroke.creationOrder[2]) || stroke.creationOrder[2] < 0) invalid("checkpoint stroke identity");
    seen.add(stroke.id);
    if (!stroke.registers?.node?.length || !stroke.registers.layout?.length || !stroke.registers.alive?.length) invalid("checkpoint missing register");
    for (const [key, entries] of Object.entries(stroke.registers)) {
      if (![...fields, "alive"].includes(key) || !Array.isArray(entries) || !entries.length || new Set(entries.map(entry => entry.operationId)).size !== entries.length) invalid("checkpoint register");
      for (const entry of entries) {
        if (!own(known, entry.operationId) || !observed(known[entry.operationId].clock, stroke.creationId)) invalid("checkpoint register causality");
        if (key === "alive") { if (typeof entry.value !== "boolean") invalid("checkpoint liveness"); }
        else field(key, entry.value);
        if (key === "node" && entry.value.attrs.id !== stroke.id) invalid("checkpoint metadata identity");
      }
      if (entries.some(entry => entries.some(other => entry !== other && observed(known[other.operationId].clock, entry.operationId)))) invalid("checkpoint register heads must be concurrent");
    }
  }
  return state;
}

/** Incremental replay: checkpoints retain causal metadata and current register heads,
 * not the historical sample payloads. Old operations remain in the durable journal
 * for selective undo and later peer reconciliation; this is not peer-safe GC. */
export function checkpointInkOperations(operations, checkpoint) {
  if (!operations.length && !checkpoint) invalid("a scope is required for an empty operation set");
  const state = checkpoint ? clone(checkpoint) : emptyInkCheckpoint(operations[0]);
  validateInkCheckpoint(state);
  const known = new Map(Object.entries(state.known)), pending = new Map(), strokes = new Map(state.strokes.map(stroke => [stroke.id, stroke]));
  const frontier = new Set(state.frontier);
  for (const operation of operations) {
    validateInkOperation(operation);
    if (operation.pageId !== state.pageId || operation.boardId !== state.boardId) invalid("cross-Board replay");
    const hash = inkOperationDigest(operation), existing = known.get(operation.id), queued = pending.get(operation.id);
    if (existing && existing.hash !== hash || queued && queued.hash !== hash) invalid(`operation id collision: ${operation.id}`);
    if (!existing) pending.set(operation.id, { operation, hash });
  }
  while (pending.size) {
    const ready = [...pending.values()].filter(({ operation }) => operation.parents.every(parent => known.has(parent))).sort((a, b) => compare(a.operation.id, b.operation.id));
    if (!ready.length) invalid(`missing causal dependency or cycle: ${[...pending.keys()].sort(compare).join(", ")}`);
    for (const { operation, hash } of ready) {
      const clock = Object.create(null);
      for (const parent of operation.parents) for (const [actor, sequence] of Object.entries(known.get(parent).clock)) clock[actor] = Math.max(clock[actor] ?? 0, sequence);
      clock[operation.actor] = operation.sequence;
      const level = 1 + Math.max(0, ...operation.parents.map(parent => known.get(parent).level));
      const write = (stroke, key, value) => {
        const entries = (stroke.registers[key] ?? []).filter(entry => !observed(clock, entry.operationId));
        stroke.registers[key] = [...entries, { operationId: operation.id, value: clone(value) }].sort((a, b) => compare(a.operationId, b.operationId));
      };
      for (const [index, change] of operation.changes.entries()) {
        let stroke = strokes.get(change.strokeId);
        if (change.kind === "create") {
          if (stroke) invalid(`stroke id was already created (including tombstones): ${change.strokeId}`);
          stroke = { id: change.strokeId, creationId: operation.id, creationOrder: [level, operation.id, index], registers: {} };
          strokes.set(change.strokeId, stroke);
          write(stroke, "node", inkNodeMetadata(change.node)); write(stroke, "layout", change.layout); write(stroke, "alive", true);
          attributes.forEach(key => write(stroke, key, change.node.attrs[key] ?? null));
        } else {
          if (!stroke || !observed(clock, stroke.creationId)) invalid(`edit does not observe stroke creation: ${change.strokeId}`);
          if (change.kind === "edit") Object.entries(change.patch).forEach(([key, value]) => write(stroke, key, value));
          else if (change.kind === "delete") write(stroke, "alive", false);
          else {
            if (!(stroke.registers.alive ?? []).some(entry => entry.value === false && observed(clock, entry.operationId))) invalid("restore must explicitly observe a deletion");
            write(stroke, "alive", true);
          }
        }
      }
      known.set(operation.id, { hash, clock, level });
      operation.parents.forEach(parent => frontier.delete(parent));
      frontier.add(operation.id); pending.delete(operation.id);
    }
  }
  state.known = Object.fromEntries([...known].sort(([a], [b]) => compare(a, b)));
  state.frontier = [...frontier].sort(compare);
  state.strokes = [...strokes.values()].sort((a, b) => a.creationOrder[0] - b.creationOrder[0] || compare(a.creationOrder[1], b.creationOrder[1]) || a.creationOrder[2] - b.creationOrder[2]);
  return state;
}

export function materializeInkOperations(operations, checkpoint) {
  const state = checkpointInkOperations(operations, checkpoint), conflicts = [];
  const strokes = state.strokes.map(stroke => {
    const node = clone(stroke.registers.node[0].value), heads = {}, local = [];
    let frame;
    for (const [key, entries] of Object.entries(stroke.registers)) {
      heads[key] = entries.map(entry => entry.operationId);
      if (new Set(entries.map(entry => canonicalInkJSON(entry.value))).size > 1) {
        const conflict = { strokeId: stroke.id, field: key, candidates: clone(entries) };
        local.push(conflict); conflicts.push(conflict);
      }
      if (key === "layout") frame = clone(entries[0].value);
      else if (attributes.includes(key)) {
        if (entries[0].value === null) delete node.attrs[key];
        else node.attrs[key] = clone(entries[0].value);
      }
    }
    for (const deletion of stroke.registers.alive.filter(entry => entry.value === false)) {
      for (const [key, entries] of Object.entries(stroke.registers)) {
        if (key === "alive") continue;
        const concurrent = entries.filter(entry => !observed(state.known[deletion.operationId].clock, entry.operationId) && !observed(state.known[entry.operationId].clock, deletion.operationId));
        if (concurrent.length) {
          const conflict = { strokeId: stroke.id, field: `delete/${key}`, candidates: clone([deletion, ...concurrent]) };
          local.push(conflict); conflicts.push(conflict);
        }
      }
    }
    // Any concurrent deletion hides the stroke; source data and delete/edit
    // conflicts survive. A snapshot consumer must explicitly resolve conflicts.
    return { id: stroke.id, node, layout: frame, deleted: stroke.registers.alive.some(entry => entry.value === false), heads, conflicts: local };
  });
  return { pageId: state.pageId, boardId: state.boardId, frontier: state.frontier, strokes, conflicts };
}

/** Selective undo never writes over a later or concurrent remote register head.
 * New concurrent arrivals can still produce explicit conflicts, never silent loss. */
export function compensateInkOperation(operations, operationId, identity) {
  const target = operations.find(operation => operation.id === operationId);
  if (!target) invalid("undo target is missing from retained journal");
  const state = checkpointInkOperations(operations), current = new Map(state.strokes.map(stroke => [stroke.id, stroke]));
  const clock = state.known[operationId].clock;
  const before = operations.filter(operation => operation.id !== operationId && observed(clock, operation.id));
  const previous = before.length ? new Map(materializeInkOperations(before).strokes.map(stroke => [stroke.id, stroke])) : new Map();
  const changes = [], skipped = [];
  for (const change of target.changes) {
    const stroke = current.get(change.strokeId), prior = previous.get(change.strokeId);
    const active = key => stroke.registers[key]?.length === 1 && stroke.registers[key][0].operationId === operationId;
    if (change.kind === "create") {
      if (Object.values(stroke.registers).every(entries => entries.every(entry => entry.operationId === operationId))) changes.push({ kind: "delete", strokeId: change.strokeId });
      else skipped.push({ strokeId: change.strokeId, field: "create" });
    } else if (change.kind === "edit") {
      const patch = {};
      for (const key of Object.keys(change.patch)) {
        if (active(key)) patch[key] = key === "layout" ? prior.layout : key === "node" ? inkNodeMetadata(prior.node) : prior.node.attrs[key] ?? null;
        else skipped.push({ strokeId: change.strokeId, field: key });
      }
      if (Object.keys(patch).length) changes.push({ kind: "edit", strokeId: change.strokeId, patch });
    } else if (active("alive")) changes.push({ kind: change.kind === "delete" ? "restore" : "delete", strokeId: change.strokeId });
    else skipped.push({ strokeId: change.strokeId, field: "alive" });
  }
  const parents = [...new Set([...state.frontier, ...(identity.sequence > 1 ? [`${identity.actor}:${identity.sequence - 1}`] : [])])];
  return { operation: changes.length ? createInkOperation({ ...identity, pageId: state.pageId, boardId: state.boardId, parents, changes }) : null, skipped };
}

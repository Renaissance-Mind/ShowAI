import { canonicalInkJSON, inkNodeMetadata, inkOperationDigest } from "./ink-operations.mjs";
import { isInkNode } from "./portable-ink.mjs";

export const INK_WIRE_FORMAT = "showai-ink-state-v1";
export class InkWireError extends Error { constructor(message) { super(`Ink causal state: ${message}`); this.name = "InkWireError"; this.code = "INK_CAUSAL_CONFLICT"; } }
const fields = ["node", "ink", "color", "strokeWidth", "pressure", "layout", "placement", "alive"];
const own = (value, key) => Object.hasOwn(value, key);
const clone = value => JSON.parse(canonicalInkJSON(value));
const hash = value => inkOperationDigest(value ?? null);
const equal = (a, b) => canonicalInkJSON(a ?? null) === canonicalInkJSON(b ?? null);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = message => { throw new InkWireError(message); };
const dotPattern = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,95}):([1-9][0-9]*)$/;
function dotParts(dot) { const match = dotPattern.exec(dot); if (!match || !Number.isSafeInteger(Number(match[2]))) fail("invalid edit dot"); return [match[1], Number(match[2])]; }
const seen = (clock, dot) => { const [actor, sequence] = dotParts(dot); return (clock[actor] ?? 0) >= sequence; };
const joinClock = (...clocks) => {
  const result = Object.create(null);
  for (const clock of clocks) for (const [actor, sequence] of Object.entries(clock)) result[actor] = Math.max(result[actor] ?? 0, sequence);
  return result;
};
const aliveHash = hash(true), deletedHash = hash(false);
const isDeleted = stroke => stroke?.fields?.alive?.some(([, digest]) => digest === deletedHash) ?? false;
const birthOrder = (a, b) => a[0] - b[0] || compare(a[1], b[1]) || a[2] - b[2];

function clock(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 512) fail("invalid causal clock");
  for (const [actor, sequence] of Object.entries(value)) if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(actor) || !Number.isSafeInteger(sequence) || sequence < 1) fail("invalid causal clock entry");
}
export function validateInkWireState(value) {
  canonicalInkJSON(value);
  if (value?.format !== INK_WIRE_FORMAT || !Number.isSafeInteger(value.level) || value.level < 0 || !value.strokes || !value.contexts || Object.keys(value.strokes).length > 100000) fail("unsupported format or excessive state");
  clock(value.clock);
  for (const [dot, context] of Object.entries(value.contexts)) { dotParts(dot); clock(context); if (!seen(context, dot) || Object.entries(context).some(([actor, sequence]) => (value.clock[actor] ?? 0) < sequence)) fail("context exceeds its causal clock"); }
  for (const [id, stroke] of Object.entries(value.strokes)) {
    if (!id || ["__proto__", "prototype", "constructor"].includes(id) || !Array.isArray(stroke.born) || stroke.born.length !== 3 || !Number.isSafeInteger(stroke.born[0]) || stroke.born[0] < 1 || !Number.isSafeInteger(stroke.born[2]) || stroke.born[2] < 0) fail("invalid stroke identity");
    dotParts(stroke.born[1]);
    if (stroke.unplaced !== undefined && stroke.unplaced !== true) fail("invalid placement conflict marker");
    if (!stroke.fields?.alive?.length) fail("missing liveness heads");
    for (const [field, heads] of Object.entries(stroke.fields)) {
      if (!fields.includes(field) || !Array.isArray(heads) || !heads.length || heads.length > 64) fail("invalid field heads");
      const dots = new Set();
      for (const head of heads) {
        if (!Array.isArray(head) || head.length !== 2 || !own(value.contexts, head[0]) || !/^[a-f0-9]{64}$/.test(head[1]) || dots.has(head[0])) fail("invalid head reference");
        dots.add(head[0]);
        if (field === "alive" && ![aliveHash, deletedHash].includes(head[1])) fail("invalid liveness digest");
      }
    }
    if (!isDeleted(stroke) && fields.some(field => !stroke.fields[field]?.length)) fail("visible stroke is missing field heads");
    for (const [field, values] of Object.entries(stroke.variants ?? {})) {
      if (!fields.includes(field) || !values || Array.isArray(values)) fail("invalid conflict variants");
      for (const [digest, variant] of Object.entries(values)) if (hash(variant) !== digest || !stroke.fields[field]?.some(([, candidate]) => digest === candidate)) fail("variant digest differs from its head");
    }
  }
  return value;
}

function boards(document) {
  const result = new Map();
  const discover = node => {
    if (node.type === "surface" && node.attrs?.kind === "board") {
      const records = new Map(); let index = 0;
      const visit = parent => {
        const children = parent.content ?? [];
        for (let i = 0; i < children.length; ++i) {
          const child = children[i];
          if (child.type === "surface") continue;
          if (isInkNode(child)) {
            const anchor = direction => {
              for (let n = i + direction; n >= 0 && n < children.length; n += direction) if (!isInkNode(children[n])) return children[n].attrs?.id ?? null;
              return null;
            };
            records.set(child.attrs.id, { node: child, layout: document.layout?.[child.attrs.id] ?? null,
              placement: { parentId: parent.attrs.id, after: anchor(-1), before: anchor(1) }, index: index++ });
          } else visit(child);
        }
      };
      visit(node); result.set(node.attrs.id, { board: node, records });
    }
    node.content?.forEach(discover);
  };
  discover(document.content); return result;
}
function fieldValue(record, field) {
  if (field === "alive") return !!record;
  if (!record) return null;
  if (field === "node") return inkNodeMetadata(record.node);
  if (field === "layout" || field === "placement") return record[field];
  return record.node.attrs[field] ?? null;
}
function empty() { return { format: INK_WIRE_FORMAT, clock: {}, level: 0, contexts: {}, strokes: {} }; }
function bootstrap(record) {
  if (record?.board.attrs.inkState) return clone(validateInkWireState(record.board.attrs.inkState));
  const state = empty(); if (!record?.records.size) return state;
  const dot = `snapshot-${hash([...record.records].map(([id, value]) => [id, fields.map(field => fieldValue(value, field))])).slice(0, 48)}:1`;
  const [actor] = dotParts(dot); state.clock[actor] = 1; state.contexts[dot] = { [actor]: 1 }; state.level = 1;
  for (const [id, value] of record.records) state.strokes[id] = { born: [1, dot, value.index], fields: Object.fromEntries(fields.map(field => [field, [[dot, hash(fieldValue(value, field))]]])) };
  return state;
}
function prune(state) {
  const referenced = new Set(Object.values(state.strokes).flatMap(stroke => Object.values(stroke.fields).flat().map(([dot]) => dot)));
  state.contexts = Object.fromEntries([...referenced].sort(compare).map(dot => [dot, state.contexts[dot]]));
  return state;
}
function compactDeleted(stroke) { stroke.fields = { alive: stroke.fields.alive }; delete stroke.variants; delete stroke.unplaced; }
function metadataMatches(record, state) {
  for (const [id, stroke] of Object.entries(state.strokes)) {
    const current = record?.records.get(id);
    if (isDeleted(stroke) !== !current) return false;
    if (current && fields.some(field => !stroke.fields[field]?.some(([, digest]) => digest === hash(fieldValue(current, field))))) return false;
  }
  return [...record.records.keys()].every(id => own(state.strokes, id));
}
function reconcile(record, baseline, identity, conflicts) {
  const before = bootstrap(baseline), supplied = record?.board.attrs.inkState;
  const suppliedValid = supplied ? validateInkWireState(supplied) : null;
  const authored = new Map(), forced = new Map();
  if (identity) {
    for (const id of new Set([...record.records.keys(), ...(baseline?.records.keys() ?? [])])) {
      const current = record.records.get(id), previous = baseline?.records.get(id);
      authored.set(id, fields.filter(field => !equal(fieldValue(current, field), fieldValue(previous, field))));
    }
    for (const change of identity.changes ?? []) forced.set(change.strokeId, [...new Set([...(forced.get(change.strokeId) ?? []), ...(change.kind === "edit" ? Object.keys(change.patch) : change.kind === "create" ? fields : ["alive"])])]);
  }
  // A current client may already have stamped its journal identity. Every
  // changed canonical field must actually have a fresh matching head.
  const alreadyStamped = suppliedValid && [...authored].every(([id, changed]) => changed.every(field => !equal(suppliedValid.strokes[id]?.fields[field], before.strokes[id]?.fields[field]))) && [...forced].every(([id, changed]) => changed.every(field => suppliedValid.strokes[id]?.fields[field]?.some(([dot]) => dot === `${identity.actor}:${identity.sequence}`)));
  if (identity && alreadyStamped && Object.entries(before.clock).every(([actor, sequence]) => (suppliedValid.clock[actor] ?? 0) >= sequence) && metadataMatches(record, suppliedValid)) return clone(suppliedValid);
  const state = identity ? before : suppliedValid ? clone(suppliedValid) : before;
  const changed = [];
  for (const id of new Set([...Object.keys(state.strokes), ...record.records.keys()])) {
    const current = record.records.get(id), stroke = state.strokes[id];
    if (!current) { if (stroke && (!isDeleted(stroke) || forced.get(id)?.includes("alive"))) changed.push({ id, values: { alive: false }, current }); continue; }
    if (!stroke) { changed.push({ id, values: Object.fromEntries(fields.map(field => [field, fieldValue(current, field)])), current }); continue; }
    if (isDeleted(stroke) && !identity) {
      conflicts.push({ strokeId: id, field: "alive", reason: "An unstamped snapshot cannot restore deleted ink." }); continue;
    }
    const placementMatches = stroke.fields.placement?.some(([, digest]) => digest === hash(fieldValue(current, "placement")));
    if (stroke.unplaced && !identity && !placementMatches) conflicts.push({ strokeId: id, field: "placement", reason: "Ink placement still requires structural resolution." });
    if (placementMatches) delete stroke.unplaced;
    const values = Object.fromEntries(fields.filter(field => !(field === "placement" && stroke.unplaced && !identity) && (authored.get(id)?.includes(field) || forced.get(id)?.includes(field) || !stroke.fields[field]?.some(([, digest]) => digest === hash(fieldValue(current, field))))).map(field => [field, fieldValue(current, field)]));
    if (Object.keys(values).length) changed.push({ id, values, current });
  }
  if (!changed.length) return prune(state);
  const actor = identity?.actor ?? `legacy-${hash([state.clock, changed.map(({ id, values }) => [id, values])]).slice(0, 48)}`;
  const sequence = identity?.sequence ?? 1, dot = `${actor}:${sequence}`;
  dotParts(dot);
  if ((state.clock[actor] ?? 0) >= sequence) fail("fresh edits require a new persisted actor sequence");
  // Unknown legacy writers have no stable device ID. Bound their fallback
  // provenance rather than silently discard causal history to save bytes.
  if (!identity && Object.keys(state.clock).filter(key => key.startsWith("legacy-")).length >= 128) fail("legacy edits require a current client with a stable writer identity");
  state.clock[actor] = sequence; state.contexts[dot] = { ...state.clock }; state.level++;
  for (const { id, values, current } of changed) {
    const stroke = state.strokes[id] ?? { born: [state.level, dot, current.index], fields: {} };
    for (const [field, value] of Object.entries(values)) { stroke.fields[field] = [[dot, hash(value)]]; if (stroke.variants) delete stroke.variants[field]; }
    if (own(values, "placement")) delete stroke.unplaced;
    if (values.alive === false) compactDeleted(stroke);
    state.strokes[id] = stroke;
  }
  return prune(state);
}

/** Save-boundary API. The baseline is the exact CAS-checked author source.
 * A persisted native journal or host counter supplies identity; it is never invented here. */
export function stampInkDocument(document, baseline, identity) {
  dotParts(`${identity.actor}:${identity.sequence}`);
  const next = clone(document), current = boards(next), previous = boards(baseline ?? { content: { type: "doc" } });
  for (const [id, record] of current) {
    if (!record.records.size && !previous.get(id)?.records.size && !record.board.attrs.inkState && !previous.get(id)?.board.attrs.inkState) continue;
    record.board.attrs.inkState = reconcile(record, previous.get(id), identity, []);
  }
  return next;
}
export function inkWireClockForActor(document, actor) {
  return Math.max(0, ...[...boards(document).values()].map(record => record.board.attrs.inkState?.clock?.[actor] ?? 0));
}
export function hasInkWireContent(document) {
  return [...boards(document).values()].some(record => record.records.size || record.board.attrs.inkState);
}

function mergeHeads(one, two, contexts) {
  const candidates = new Map();
  for (const head of [...(one ?? []), ...(two ?? [])]) {
    if (candidates.has(head[0]) && candidates.get(head[0])[1] !== head[1]) fail("one operation dot names conflicting values");
    candidates.set(head[0], head);
  }
  return [...candidates.values()].filter(head => ![...candidates.values()].some(other => other[0] !== head[0] && seen(contexts[other[0]], head[0]))).sort((a, b) => compare(a[0], b[0]));
}
function valueLookup(id, field, digest, sources) {
  if (field === "alive") return { found: true, value: digest === aliveHash };
  for (const { record, state } of sources) {
    const value = fieldValue(record?.records.get(id), field);
    if (hash(value) === digest) return { found: true, value };
    const variant = state.strokes[id]?.variants?.[field];
    if (variant && own(variant, digest)) return { found: true, value: variant[digest] };
  }
  return { found: false };
}
function joinBoard(id, base, left, right, conflicts) {
  const baseline = bootstrap(base), one = reconcile(left, base, undefined, conflicts), two = reconcile(right, base, undefined, conflicts);
  const state = empty(); state.clock = joinClock(one.clock, two.clock); state.level = Math.max(one.level, two.level);
  state.contexts = { ...one.contexts };
  for (const [dot, context] of Object.entries(two.contexts)) {
    if (state.contexts[dot] && !equal(state.contexts[dot], context)) fail("one dot names conflicting causal contexts");
    state.contexts[dot] = context;
  }
  const sources = [{ record: left, state: one }, { record: right, state: two }, { record: base, state: baseline }], visible = [];
  for (const strokeId of new Set([...Object.keys(one.strokes), ...Object.keys(two.strokes)])) {
    const a = one.strokes[strokeId], b = two.strokes[strokeId];
    if (a && b && !equal(a.born, b.born)) conflicts.push({ boardId: id, strokeId, field: "creation", reason: "Different creations reused a stable ink ID." });
    const stroke = { born: [...[a?.born, b?.born].filter(Boolean).sort(birthOrder)[0]], fields: {}, ...(a?.unplaced || b?.unplaced ? { unplaced: true } : {}) };
    for (const field of fields) {
      const heads = mergeHeads(a?.fields[field], b?.fields[field], state.contexts);
      if (heads.length) stroke.fields[field] = heads;
    }
    const local = [], selected = {};
    for (const [field, heads] of Object.entries(stroke.fields)) {
      const hashes = new Set(heads.map(([, digest]) => digest));
      if (hashes.size > 1) local.push({ boardId: id, strokeId, field, reason: "Concurrent ink field edits require resolution." });
      if (field !== "alive") {
        const resolved = valueLookup(strokeId, field, heads[0][1], sources);
        if (resolved.found) selected[field] = clone(resolved.value);
      }
    }
    for (const [dot, digest] of stroke.fields.alive) if (digest === deletedHash) {
      for (const [field, heads] of Object.entries(stroke.fields)) if (field !== "alive" && heads.some(([other]) => !seen(state.contexts[dot], other) && !seen(state.contexts[other], dot))) local.push({ boardId: id, strokeId, field: `delete/${field}`, reason: "An ink deletion overlaps a concurrent edit." });
    }
    const deleted = isDeleted(stroke);
    if (deleted && !local.length) compactDeleted(stroke);
    else {
      const variants = {};
      for (const [field, heads] of Object.entries(stroke.fields)) if (field !== "alive") {
        const values = {};
        for (const [, digest] of heads) {
          const resolved = valueLookup(strokeId, field, digest, sources);
          if (resolved.found && (deleted || digest !== hash(selected[field]))) values[digest] = clone(resolved.value);
          else if (!resolved.found) local.push({ boardId: id, strokeId, field, reason: "A referenced ink value is unavailable; source copies are retained." });
        }
        if (Object.keys(values).length) variants[field] = values;
      }
      if (Object.keys(variants).length) stroke.variants = variants;
      if (!deleted) {
        if (!selected.node || !selected.layout || !selected.placement) local.push({ boardId: id, strokeId, field: "node", reason: "Visible ink is missing its canonical source value." });
        else {
          const node = selected.node;
          for (const field of ["ink", "color", "strokeWidth", "pressure"]) { if (selected[field] === null) delete node.attrs[field]; else if (selected[field] !== undefined) node.attrs[field] = selected[field]; }
          visible.push({ id: strokeId, node, layout: selected.layout, placement: selected.placement, born: stroke.born });
        }
      }
    }
    state.strokes[strokeId] = stroke; conflicts.push(...local);
  }
  visible.sort((a, b) => birthOrder(a.born, b.born));
  return { id, state: prune(state), visible };
}

export function prepareInkPageMerge(base, ours, theirs) {
  const b = boards(base), o = boards(ours), t = boards(theirs), ids = new Set([...b.keys(), ...o.keys(), ...t.keys()]);
  const plans = [], conflicts = [], removedIds = new Set();
  for (const id of ids) {
    const before = b.get(id), left = o.get(id), right = t.get(id);
    if (![before, left, right].some(record => record?.records.size || record?.board.attrs.inkState)) continue;
    // Container deletion itself belongs to the existing structural merge.
    if (!left || !right) continue;
    for (const record of [before, left, right]) record?.records.forEach((_, id) => removedIds.add(id));
    plans.push(joinBoard(id, before, left, right, conflicts));
  }
  if (!plans.length) return null;
  const planned = new Set(plans.map(plan => plan.id));
  const strip = document => {
    const result = clone(document);
    const visit = node => {
      if (planned.has(node.attrs?.id)) delete node.attrs.inkState;
      if (node.content) node.content = node.content.filter(child => !removedIds.has(child.attrs?.id)).map(visit);
      return node;
    };
    result.content = visit(result.content);
    result.layout = Object.fromEntries(Object.entries(result.layout ?? {}).filter(([id]) => !removedIds.has(id)));
    return result;
  };
  return { base: strip(base), ours: strip(ours), theirs: strip(theirs), plans, conflicts };
}

export function finishInkPageMerge(document, prepared) {
  const result = clone(document), nodes = new Map(), conflicts = [...prepared.conflicts];
  const visit = node => { if (node.attrs?.id) nodes.set(node.attrs.id, node); node.content?.forEach(visit); }; visit(result.content);
  for (const plan of prepared.plans) {
    const board = nodes.get(plan.id);
    if (!board || board.attrs?.kind !== "board") { if (plan.visible.length) conflicts.push({ boardId: plan.id, field: "placement", reason: "The target Board was removed." }); continue; }
    board.attrs.inkState = plan.state;
    const groups = new Map();
    for (const stroke of plan.visible) {
      let parent = nodes.get(stroke.placement.parentId);
      if (!parent) { conflicts.push({ boardId: plan.id, strokeId: stroke.id, field: "placement", reason: "The ink parent was removed." }); plan.state.strokes[stroke.id].unplaced = true; parent = board; }
      const group = groups.get(parent) ?? []; group.push(stroke); groups.set(parent, group);
      result.layout ??= {}; result.layout[stroke.id] = stroke.layout;
    }
    for (const [parent, ink] of groups) {
      const existing = parent.content ?? [], ids = new Set([...existing.map(node => node.attrs.id), ...ink.map(stroke => stroke.id)]);
      const edges = new Map([...ids].map(id => [id, new Set()])), degree = new Map([...ids].map(id => [id, 0]));
      const connect = (a, b) => { if (a && b && ids.has(a) && ids.has(b) && a !== b && !edges.get(a).has(b)) { edges.get(a).add(b); degree.set(b, degree.get(b) + 1); } };
      for (let i = 1; i < existing.length; ++i) connect(existing[i - 1].attrs.id, existing[i].attrs.id);
      for (const stroke of ink) { connect(stroke.placement.after, stroke.id); connect(stroke.id, stroke.placement.before); }
      const rank = new Map([...existing.map(node => node.attrs.id), ...ink.map(stroke => stroke.id)].map((id, i) => [id, i]));
      const ready = [...ids].filter(id => degree.get(id) === 0), ordered = [];
      while (ready.length) {
        ready.sort((a, b) => rank.get(a) - rank.get(b)); const id = ready.shift(); ordered.push(id);
        for (const next of edges.get(id)) { degree.set(next, degree.get(next) - 1); if (degree.get(next) === 0) ready.push(next); }
      }
      const byId = new Map([...existing.map(node => [node.attrs.id, node]), ...ink.map(stroke => [stroke.id, stroke.node])]);
      if (ordered.length !== ids.size) {
        conflicts.push({ boardId: plan.id, field: "placement", reason: "Concurrent ink placement and object ordering form a cycle." });
        for (const stroke of ink) plan.state.strokes[stroke.id].unplaced = true;
        parent.content = [...existing, ...ink.map(stroke => stroke.node)];
      }
      else parent.content = ordered.map(id => byId.get(id));
      if (parent.type === "surface" && result.surfaceViews?.[parent.attrs.id]) result.surfaceViews[parent.attrs.id].readingOrder = parent.content.map(node => node.attrs.id);
    }
  }
  return { document: result, conflicts };
}

/** Explicit resolution is an authored edit with a real persisted identity. The
 * selected value may equal the visible value; its new causal dot still matters. */
export function resolveInkWireFields(document, choices, identity) {
  const next = clone(document), forced = [];
  const locate = id => {
    const visit = (node, parent) => node.attrs?.id === id ? { node, parent } : node.content?.map(child => visit(child, node)).find(Boolean);
    return visit(next.content, null);
  };
  const insert = (node, placement) => {
    const parent = locate(placement.parentId)?.node; if (!parent) fail("resolution target parent was removed");
    const children = parent.content ??= [];
    let index = placement.before ? children.findIndex(child => child.attrs?.id === placement.before) : -1;
    if (index < 0 && placement.after) { const after = children.findIndex(child => child.attrs?.id === placement.after); if (after >= 0) index = after + 1; }
    children.splice(index < 0 ? children.length : index, 0, node);
  };
  for (const choice of choices) {
    const record = boards(next).get(choice.boardId), state = record?.board.attrs.inkState, stroke = state?.strokes[choice.strokeId];
    if (!stroke?.fields[choice.field]?.some(([, digest]) => digest === choice.hash)) fail("resolution does not name a current candidate");
    const resolved = valueLookup(choice.strokeId, choice.field, choice.hash, [{ record, state }]);
    if (!resolved.found) fail("resolution source is unavailable");
    let found = locate(choice.strokeId);
    if (choice.field === "alive") {
      if (!resolved.value) {
        if (found?.parent) found.parent.content = found.parent.content.filter(child => child !== found.node);
        if (next.layout) delete next.layout[choice.strokeId];
        forced.push({ kind: "delete", strokeId: choice.strokeId });
      } else {
        if (!found) {
          const values = {};
          for (const field of fields.filter(field => field !== "alive")) {
            const candidate = stroke.fields[field]?.[0], value = candidate && valueLookup(choice.strokeId, field, candidate[1], [{ record, state }]);
            if (!value?.found) fail("restoring erased source requires its retained journal or conflict variant");
            values[field] = clone(value.value);
          }
          const node = values.node;
          for (const field of ["ink", "color", "strokeWidth", "pressure"]) { if (values[field] !== null) node.attrs[field] = values[field]; }
          insert(node, values.placement); next.layout ??= {}; next.layout[choice.strokeId] = values.layout;
        }
        forced.push({ kind: "restore", strokeId: choice.strokeId });
      }
      continue;
    }
    if (!found) fail("resolve deletion by keeping or restoring the stroke before choosing its fields");
    const value = clone(resolved.value);
    if (choice.field === "layout") next.layout[choice.strokeId] = value;
    else if (choice.field === "placement") { found.parent.content = found.parent.content.filter(child => child !== found.node); insert(found.node, value); }
    else if (choice.field === "node") {
      const attributes = Object.fromEntries(["ink", "color", "strokeWidth", "pressure"].filter(key => own(found.node.attrs, key)).map(key => [key, found.node.attrs[key]]));
      const node = { ...value, attrs: { ...value.attrs, ...attributes } };
      found.parent.content = found.parent.content.map(child => child === found.node ? node : child);
    } else if (value === null) delete found.node.attrs[choice.field];
    else found.node.attrs[choice.field] = value;
    forced.push({ kind: "edit", strokeId: choice.strokeId, patch: { [choice.field]: value } });
  }
  return stampInkDocument(next, document, { ...identity, changes: forced });
}

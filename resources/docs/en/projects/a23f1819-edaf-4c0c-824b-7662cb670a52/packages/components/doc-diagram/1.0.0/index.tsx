import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import './style.css';

type Tone = 'brand' | 'teal' | 'warm' | 'violet' | 'rose' | 'slate';
type DNode = { id: string; label: string; sub?: string; col: number; row: number; tone?: Tone; icon?: string; detail?: string; href?: string };
type DEdge = { from: string; to: string; label?: string; dashed?: boolean; both?: boolean };
type DGroup = { label: string; from: [number, number]; to: [number, number]; tone?: Tone };
type Data = { nodes: DNode[]; edges: DEdge[]; groups?: DGroup[]; initial?: string; caption?: string };

const TONES: Tone[] = ['brand', 'teal', 'warm', 'violet', 'rose', 'slate'];
const tone = (t?: string): Tone => (TONES.includes(t as Tone) ? (t as Tone) : 'brand');

/* ------------------------------------------------------------ markdown-lite (shared across the kit) */
const DOCS = 'https://showai.renaissancemind.ai/doc';
function linkHref(t: string): string | null {
  if (t.startsWith('doc:')) {
    const [slug, anchor] = t.slice(4).split('#');
    return DOCS + (slug ? `/${slug}` : '') + (anchor ? `#${anchor}` : '');
  }
  return /^(https?:|mailto:|#)/i.test(t) ? t : null;
}
const TOKEN = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
function inline(src: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = new RegExp(TOKEN.source, 'g');
  let pos = 0, i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > pos) out.push(src.slice(pos, m.index));
    const k = `${key}.${i++}`;
    if (m[1] != null) out.push(<strong key={k}>{inline(m[1], k)}</strong>);
    else if (m[2] != null) out.push(<code key={k}>{m[2]}</code>);
    else {
      const h = linkHref(m[4]);
      out.push(h ? <a key={k} href={h}>{inline(m[3], k)}</a> : <span key={k}>{inline(m[3], k)}</span>);
    }
    pos = re.lastIndex;
  }
  if (pos < src.length) out.push(src.slice(pos));
  return out;
}
/** Paragraphs split on newlines; **bold**, `code`, [label](href | doc:slug#anchor). Never injects HTML. */
export function md(src?: string): React.ReactNode {
  if (!src) return null;
  return src.split(/\n+/).map((s) => s.trim()).filter(Boolean).map((p, i) => <p key={i}>{inline(p, `p${i}`)}</p>);
}

/* ------------------------------------------------------------ text measuring */
const FONT = "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
let ctx: CanvasRenderingContext2D | null | undefined;
function textW(s: string, size: number, weight = 400) {
  if (ctx === undefined) {
    try { ctx = document.createElement('canvas').getContext('2d'); } catch { ctx = null; }
  }
  if (ctx) { ctx.font = `${weight} ${size}px ${FONT}`; return ctx.measureText(s).width; }
  let w = 0;
  for (const ch of s) w += /[⺀-￿]/.test(ch) ? size : size * 0.58;
  return w;
}
function fit(s: string, max: number, size: number, weight = 400) {
  if (textW(s, size, weight) <= max) return s;
  const chars = Array.from(s);
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textW(chars.slice(0, mid).join('') + '…', size, weight) <= max) lo = mid; else hi = mid - 1;
  }
  return chars.slice(0, lo).join('').trimEnd() + '…';
}

/** Greedy wrap (CJK breaks anywhere, latin runs stay whole) into at most `maxLines`; the last line gets an ellipsis. */
function wrap(s: string, max: number, size: number, weight: number, maxLines: number): string[] {
  const toks = s.match(/[A-Za-z0-9_./~:@#%+\-]+\s*|\s+|[^]/gu) || [];
  const lines: string[] = [];
  let cur = '';
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    // keep closing punctuation with the previous character
    if (!cur || textW(cur + t, size, weight) <= max || /^[，。、；：！？）」』》,.;:!?)]$/.test(t)) { cur += t; continue; }
    lines.push(cur.trimEnd());
    cur = t.trimStart();
    if (lines.length === maxLines - 1) { lines.push(fit((cur + toks.slice(i + 1).join('')).trim(), max, size, weight)); return lines.map((l) => fit(l, max, size, weight)); }
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.map((l) => fit(l, max, size, weight));
}

/* ------------------------------------------------------------ data normalisation */
type Clean = {
  nodes: (DNode & { tone: Tone })[];
  edges: (DEdge & { a: number; b: number; i: number })[];
  groups: (DGroup & { tone: Tone; c0: number; c1: number; r0: number; r1: number })[];
  skipped: { nodes: string[]; edges: string[]; groups: string[] };
  cols: number; rows: number;
};
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
function clean(data: Data): Clean {
  const skipped = { nodes: [] as string[], edges: [] as string[], groups: [] as string[] };
  const seen = new Set<string>(), cells = new Set<string>();
  const nodes: Clean['nodes'] = [];
  for (const n of Array.isArray(data?.nodes) ? data.nodes : []) {
    if (!n || typeof n.id !== 'string' || !n.label || !finite(n.col) || !finite(n.row)) { skipped.nodes.push(String(n?.id ?? '?')); continue; }
    const cell = `${Math.round(n.col)},${Math.round(n.row)}`;
    if (seen.has(n.id) || cells.has(cell)) { skipped.nodes.push(n.id); continue; }
    seen.add(n.id); cells.add(cell);
    nodes.push({ ...n, col: Math.round(n.col), row: Math.round(n.row), tone: tone(n.tone) });
  }
  const rawGroups = (Array.isArray(data?.groups) ? data.groups : []).filter((g) => {
    const ok = g && Array.isArray(g.from) && Array.isArray(g.to) && [...g.from, ...g.to].every(finite);
    if (!ok) skipped.groups.push(String(g?.label ?? '?'));
    return ok;
  });
  const cs = [...nodes.map((n) => n.col), ...rawGroups.flatMap((g) => [g.from[0], g.to[0]])];
  const rs = [...nodes.map((n) => n.row), ...rawGroups.flatMap((g) => [g.from[1], g.to[1]])];
  const c0 = cs.length ? Math.min(...cs) : 0, r0 = rs.length ? Math.min(...rs) : 0;
  const cols = cs.length ? Math.max(...cs) - c0 + 1 : 0, rows = rs.length ? Math.max(...rs) - r0 + 1 : 0;
  // Reading order: row by row, left to right. Tab follows it.
  nodes.forEach((n) => { n.col -= c0; n.row -= r0; });
  nodes.sort((p, q) => p.row - q.row || p.col - q.col);
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const edges: Clean['edges'] = [];
  (Array.isArray(data?.edges) ? data.edges : []).forEach((e, i) => {
    const a = index.get(e?.from), b = index.get(e?.to);
    if (a == null || b == null || a === b) { skipped.edges.push(`${e?.from ?? '?'}→${e?.to ?? '?'}`); return; }
    edges.push({ ...e, a, b, i });
  });
  const groups = rawGroups.map((g) => ({
    ...g, tone: tone(g.tone),
    c0: Math.round(Math.min(g.from[0], g.to[0]) - c0), c1: Math.round(Math.max(g.from[0], g.to[0]) - c0),
    r0: Math.round(Math.min(g.from[1], g.to[1]) - r0), r1: Math.round(Math.max(g.from[1], g.to[1]) - r0),
  }));
  return { nodes, edges, groups, skipped, cols, rows };
}

export function readData(data: Data) {
  const c = clean(data);
  const name = (i: number) => c.nodes[i].label;
  return {
    grid: { columns: c.cols, rows: c.rows },
    nodes: c.nodes.map((n, i) => ({
      id: n.id, label: n.label, col: n.col, row: n.row,
      connectsTo: c.edges.filter((e) => e.a === i || (e.both && e.b === i)).map((e) => ({ node: name(e.a === i ? e.b : e.a), label: e.label ?? null })),
      from: c.edges.filter((e) => e.b === i && !e.both).map((e) => name(e.a)),
      hasDetail: Boolean(n.detail), href: n.href ?? null,
    })),
    groups: c.groups.map((g) => ({ label: g.label, members: c.nodes.filter((n) => n.col >= g.c0 && n.col <= g.c1 && n.row >= g.r0 && n.row <= g.r1).map((n) => n.label) })),
    skipped: c.skipped,
    initial: data?.initial && c.nodes.some((n) => n.id === data.initial) ? data.initial : null,
  };
}

/* ------------------------------------------------------------ geometry */
type Pt = { x: number; y: number };
type Side = 'top' | 'bottom' | 'left' | 'right';
type Box = { x: number; y: number; w: number; h: number; cx: number; cy: number };
type Kind = 'h' | 'v' | 'vz' | 'hz' | 'over' | 'around';
type Route = {
  e: Clean['edges'][number]; kind: Kind; sa: Side; sb: Side;
  gutter?: { axis: 'h' | 'v'; key: number };
  offA: number; offB: number; lane: number;
  pts: Pt[]; label?: { x: number; y: number; w: number; text: string; axis: 'x' | 'y'; lo: number; hi: number };
};
type Layout = {
  W: number; H: number; boxes: Box[]; nodeH: number; routes: Route[];
  text: { label: string[]; sub: string[]; tx: number }[]; lines: { label: number; sub: number };
  groups: { x: number; y: number; w: number; h: number; label: string; tone: Tone }[];
};

const PILL_F = 12;
const pillW = (s: string) => Math.ceil(textW(s, PILL_F, 500)) + 14;

function layout(c: Clean, width: number): Layout | null {
  const { nodes, edges, cols, rows } = c;
  if (!nodes.length || width <= 0) return null;
  const gapY = c.groups.length ? 88 : 64;

  const at = new Map<string, number>();
  nodes.forEach((n, i) => at.set(`${n.col},${n.row}`, i));
  const occupied = (col: number, row: number) => at.has(`${col},${row}`);
  const clearCol = (col: number, r1: number, r2: number) => { for (let r = Math.min(r1, r2) + 1; r < Math.max(r1, r2); r++) if (occupied(col, r)) return false; return true; };
  const clearRow = (row: number, c1: number, c2: number) => { for (let k = Math.min(c1, c2) + 1; k < Math.max(c1, c2); k++) if (occupied(k, row)) return false; return true; };

  // 1. Route kinds (abstract: sides + gutter).
  const routes: Route[] = edges.map((e) => {
    const A = nodes[e.a], B = nodes[e.b];
    const dc = B.col - A.col, dr = B.row - A.row;
    const base = { e, offA: 0, offB: 0, lane: 0, pts: [] as Pt[] };
    if (dr === 0) {
      if (clearRow(A.row, A.col, B.col)) return { ...base, kind: 'h', sa: dc > 0 ? 'right' : 'left', sb: dc > 0 ? 'left' : 'right' };
      const below = A.row < rows - 1 || A.row === 0;
      return { ...base, kind: 'over', sa: below ? 'bottom' : 'top', sb: below ? 'bottom' : 'top', gutter: { axis: 'h', key: below ? A.row + 1 : A.row } };
    }
    if (dc === 0) {
      if (clearCol(A.col, A.row, B.row)) return { ...base, kind: 'v', sa: dr > 0 ? 'bottom' : 'top', sb: dr > 0 ? 'top' : 'bottom' };
      const right = A.col < cols - 1 || A.col === 0;
      return { ...base, kind: 'around', sa: right ? 'right' : 'left', sb: right ? 'right' : 'left', gutter: { axis: 'v', key: right ? A.col + 1 : A.col } };
    }
    const down = dr > 0, rightward = dc > 0;
    const vz = (key: number): Route => ({ ...base, kind: 'vz', sa: down ? 'bottom' : 'top', sb: down ? 'top' : 'bottom', gutter: { axis: 'h', key } });
    const hz = (key: number): Route => ({ ...base, kind: 'hz', sa: rightward ? 'right' : 'left', sb: rightward ? 'left' : 'right', gutter: { axis: 'v', key } });
    // Vertical-first Z through the row gutter next to B (or next to A), else horizontal-first Z
    // through a column gutter; each is used only when its straight leg crosses no other node.
    const nearB = down ? B.row : B.row + 1, nearA = down ? A.row + 1 : A.row;
    if (clearCol(A.col, A.row, B.row)) return vz(nearB);
    if (clearCol(B.col, B.row, A.row)) return vz(nearA);
    const vB = rightward ? B.col : B.col + 1, vA = rightward ? A.col + 1 : A.col;
    if (clearRow(A.row, A.col, B.col)) return hz(vB);
    if (clearRow(B.row, B.col, A.col)) return hz(vA);
    return vz(nearB);
  });

  // 2. Margins depend on which outer gutters and groups are used.
  const usesH = (k: number) => routes.some((r) => r.gutter?.axis === 'h' && r.gutter.key === k);
  const usesV = (k: number) => routes.some((r) => r.gutter?.axis === 'v' && r.gutter.key === k);
  const groupTop = c.groups.some((g) => g.r0 === 0), groupBottom = c.groups.some((g) => g.r1 === rows - 1);
  const top = Math.max(groupTop ? 32 : 4, usesH(0) ? gapY / 2 + 14 : 0) + 2;
  const bottom = Math.max(groupBottom ? 16 : 4, usesH(rows) ? gapY / 2 + 14 : 0) + 2;
  // Horizontal sizing: outer margins only as wide as groups / outer detours need; the gap between
  // columns fits the widest same-row edge label; nodes take the rest (capped, then centred).
  const outer = (k: number) => Math.max(c.groups.length ? 18 : 2, usesV(k) ? 32 : 0);
  const OL = outer(0), OR = outer(cols), span = width - OL - OR;
  const sameRow = edges.filter((e) => nodes[e.a].row === nodes[e.b].row && Math.abs(nodes[e.a].col - nodes[e.b].col) === 1 && e.label);
  const wantGap = Math.max(48, ...sameRow.map((e) => pillW(e.label!) + 10));
  let gapX = cols > 1 ? Math.max(40, Math.min(wantGap, span * 0.16)) : 0;
  let nodeW = (span - (cols - 1) * gapX) / cols;
  if (nodeW < 124 && cols > 1) { gapX = Math.max(40, (span - 124 * cols) / (cols - 1)); nodeW = (span - (cols - 1) * gapX) / cols; }
  if (nodeW < 104) return null; // too many columns for this width: the list view takes over
  if (nodeW > 240) { nodeW = 240; gapX = cols > 1 ? Math.min(150, (span - cols * nodeW) / (cols - 1)) : 0; }
  // Text: label and sub each wrap to two lines; every node gets the same height so rows stay aligned.
  const text = nodes.map((n) => {
    const tx = n.icon ? 44 : 14;
    const avail = nodeW - tx - 10;
    return { tx, label: wrap(n.label, avail, 14, 600, 2), sub: n.sub ? wrap(n.sub, avail, 12, 400, 2) : [] };
  });
  const lines = { label: Math.max(1, ...text.map((t) => t.label.length)), sub: Math.max(0, ...text.map((t) => t.sub.length)) };
  const nodeH = Math.max(44, 22 + lines.label * 19 + (lines.sub ? 3 + lines.sub * 16 : 0));
  const rowH = nodeH + gapY;
  const pitch = nodeW + gapX;
  const x0 = OL + (span - cols * nodeW - (cols - 1) * gapX) / 2;
  const colX = (k: number) => x0 + k * pitch;
  const boxes: Box[] = nodes.map((n) => {
    const x = colX(n.col), y = top + n.row * rowH;
    return { x, y, w: nodeW, h: nodeH, cx: x + nodeW / 2, cy: y + nodeH / 2 };
  });
  const H = top + rows * rowH - gapY + bottom;
  // With groups, the free band between rows runs from a group's bottom padding (14) to the next
  // group's label strip (30): centre gutter runs there, not on the group borders.
  const hY = (k: number) => top + k * rowH - gapY / 2 - (c.groups.length ? 8 : 0);
  const vX = (k: number) => (k <= 0 ? x0 - 16 : k >= cols ? colX(cols - 1) + nodeW + 16 : colX(k) - gapX / 2);

  // 3. Ports: spread endpoints along each side, ordered by where the other end lies.
  type End = { r: Route; end: 'a' | 'b'; key: number; straight: boolean };
  const sides = new Map<string, End[]>();
  for (const r of routes) {
    for (const end of ['a', 'b'] as const) {
      const other = boxes[end === 'a' ? r.e.b : r.e.a];
      const side = end === 'a' ? r.sa : r.sb;
      const key = side === 'top' || side === 'bottom' ? other.cx : other.cy;
      const id = `${end === 'a' ? r.e.a : r.e.b}:${side}`;
      if (!sides.has(id)) sides.set(id, []);
      sides.get(id)!.push({ r, end, key, straight: r.kind === 'h' || r.kind === 'v' });
    }
  }
  for (const [id, list] of sides) {
    const [ni, side] = id.split(':');
    const me = boxes[Number(ni)];
    const horiz = side === 'top' || side === 'bottom';
    const centre = horiz ? me.cx : me.cy, len = horiz ? me.w : me.h;
    const s = horiz ? Math.min(28, (len - 28) / Math.max(1, list.length)) : Math.min(12, (len - 14) / Math.max(1, list.length));
    const C = list.filter((p) => p.straight || Math.abs(p.key - centre) < 1).sort((p, q) => p.r.e.i - q.r.e.i);
    const L = list.filter((p) => !C.includes(p) && p.key < centre).sort((p, q) => p.key - q.key);
    const R = list.filter((p) => !C.includes(p) && p.key >= centre).sort((p, q) => p.key - q.key);
    const half = C.length ? ((C.length - 1) / 2) * s : -s / 2;
    const set = (p: End, off: number) => {
      const lim = len / 2 - 10;
      const v = Math.max(-lim, Math.min(lim, off));
      if (p.end === 'a') p.r.offA = v; else p.r.offB = v;
    };
    C.forEach((p, j) => set(p, (j - (C.length - 1) / 2) * s));
    L.forEach((p, j) => set(p, -(half + s * (L.length - j))));
    R.forEach((p, j) => set(p, half + s * (j + 1)));
  }

  const port = (b: Box, side: Side, off: number): Pt => {
    switch (side) {
      case 'top': return { x: b.cx + off, y: b.y };
      case 'bottom': return { x: b.cx + off, y: b.y + b.h };
      case 'left': return { x: b.x, y: b.cy + off };
      default: return { x: b.x + b.w, y: b.cy + off };
    }
  };

  // 4. Lanes inside shared gutters so parallel runs don't sit on top of each other.
  const gutters = new Map<string, { r: Route; lo: number; hi: number }[]>();
  for (const r of routes) {
    if (!r.gutter) continue;
    const p = port(boxes[r.e.a], r.sa, r.offA), q = port(boxes[r.e.b], r.sb, r.offB);
    const [lo, hi] = r.gutter.axis === 'h' ? [Math.min(p.x, q.x), Math.max(p.x, q.x)] : [Math.min(p.y, q.y), Math.max(p.y, q.y)];
    const id = `${r.gutter.axis}${r.gutter.key}`;
    if (!gutters.has(id)) gutters.set(id, []);
    gutters.get(id)!.push({ r, lo, hi });
  }
  const laneCount = new Map<string, number>();
  for (const [id, segs] of gutters) {
    segs.sort((p, q) => p.lo - q.lo || p.hi - q.hi);
    const ends: number[] = [];
    for (const sg of segs) {
      let lane = ends.findIndex((h) => h < sg.lo - 8);
      if (lane < 0) { lane = ends.length; ends.push(sg.hi); } else ends[lane] = sg.hi;
      sg.r.lane = lane;
    }
    laneCount.set(id, ends.length);
  }

  // 5. Points.
  for (const r of routes) {
    const p = port(boxes[r.e.a], r.sa, r.offA), q = port(boxes[r.e.b], r.sb, r.offB);
    if (!r.gutter) { r.pts = [p, q]; continue; }
    const id = `${r.gutter.axis}${r.gutter.key}`;
    const n = laneCount.get(id) || 1, lane = (r.lane - (n - 1) / 2) * 10;
    if (r.gutter.axis === 'h') {
      const y = hY(r.gutter.key) + lane;
      r.pts = [p, { x: p.x, y }, { x: q.x, y }, q];
    } else {
      const x = vX(r.gutter.key) + lane;
      r.pts = [p, { x, y: p.y }, { x, y: q.y }, q];
    }
    r.pts = simplify(r.pts);
  }

  // 6. Labels: middle of the gutter run when it is long enough, otherwise the longest run.
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  for (const r of routes) {
    if (!r.e.label) continue;
    const w = pillW(r.e.label);
    const segs = r.pts.slice(1).map((q, j) => ({ p: r.pts[j], q, len: Math.hypot(q.x - r.pts[j].x, q.y - r.pts[j].y) }));
    let seg = segs.length === 3 && segs[1].len >= (Math.abs(segs[1].q.x - segs[1].p.x) > 0 ? w + 16 : 36) ? segs[1] : segs.reduce((m, s) => (s.len > m.len ? s : m), segs[0]);
    if (!seg) continue;
    const axis: 'x' | 'y' = Math.abs(seg.q.x - seg.p.x) >= Math.abs(seg.q.y - seg.p.y) ? 'x' : 'y';
    const lo = axis === 'x' ? Math.min(seg.p.x, seg.q.x) : Math.min(seg.p.y, seg.q.y);
    const hi = axis === 'x' ? Math.max(seg.p.x, seg.q.x) : Math.max(seg.p.y, seg.q.y);
    const lab = { x: (seg.p.x + seg.q.x) / 2, y: (seg.p.y + seg.q.y) / 2, w, text: r.e.label, axis, lo, hi };
    const ra = nodes[r.e.a].row, rb = nodes[r.e.b].row;
    if (r.kind === 'v' && Math.abs(ra - rb) === 1) lab.y = hY(Math.max(ra, rb));
    // Nudge along the run if it collides with an earlier label.
    for (let tries = 0; tries < 4; tries++) {
      const hit = placed.find((o) => Math.abs(o.x - lab.x) < (o.w + w) / 2 + 4 && Math.abs(o.y - lab.y) < 22);
      if (!hit) break;
      if (axis === 'x') {
        const right = hit.x + (hit.w + w) / 2 + 6, left = hit.x - (hit.w + w) / 2 - 6;
        lab.x = right + w / 2 <= hi + 4 ? right : left - w / 2 >= lo - 4 ? left : lab.x;
        if (lab.x !== right && lab.x !== left) break;
      } else {
        const down = hit.y + 24, up = hit.y - 24;
        lab.y = down <= hi - 8 ? down : up >= lo + 8 ? up : lab.y;
        if (lab.y !== down && lab.y !== up) break;
      }
    }
    placed.push({ x: lab.x, y: lab.y, w, h: 20 });
    r.label = lab;
  }

  const padX = cols > 1 ? Math.min(16, gapX / 2 - 6) : 16;
  const groups = c.groups.map((g) => {
    const x = colX(g.c0) - padX, y = top + g.r0 * rowH - 30;
    return { x, y, w: (g.c1 - g.c0 + 1) * pitch - gapX + 2 * padX, h: (g.r1 - g.r0 + 1) * rowH - gapY + 30 + 14, label: g.label, tone: g.tone };
  });

  return { W: width, H, boxes, nodeH, routes, groups, text, lines };
}

function simplify(pts: Pt[]) {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  // drop collinear middles
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = out[i - 1], b = out[i + 1];
    return !((Math.abs(a.x - p.x) < 0.5 && Math.abs(b.x - p.x) < 0.5) || (Math.abs(a.y - p.y) < 0.5 && Math.abs(b.y - p.y) < 0.5));
  });
}

const ARROW = 7;
function trimmed(pts: Pt[], start: boolean, end: boolean) {
  const p = pts.map((q) => ({ ...q }));
  const cut = (i: number, j: number) => {
    const d = Math.hypot(p[j].x - p[i].x, p[j].y - p[i].y) || 1;
    const k = Math.min(ARROW - 1, d / 2) / d;
    p[i].x += (p[j].x - p[i].x) * k; p[i].y += (p[j].y - p[i].y) * k;
  };
  if (end) cut(p.length - 1, p.length - 2);
  if (start) cut(0, 1);
  return p;
}
function roundPath(pts: Pt[], r = 9) {
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], p = pts[i], b = pts[i + 1];
    const l1 = Math.hypot(p.x - a.x, p.y - a.y), l2 = Math.hypot(b.x - p.x, b.y - p.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const s = { x: p.x + ((a.x - p.x) / l1) * rr, y: p.y + ((a.y - p.y) / l1) * rr };
    const t = { x: p.x + ((b.x - p.x) / l2) * rr, y: p.y + ((b.y - p.y) / l2) * rr };
    d += `L${s.x.toFixed(1)},${s.y.toFixed(1)}Q${p.x.toFixed(1)},${p.y.toFixed(1)} ${t.x.toFixed(1)},${t.y.toFixed(1)}`;
  }
  const z = pts[pts.length - 1];
  return d + `L${z.x.toFixed(1)},${z.y.toFixed(1)}`;
}
function head(tip: Pt, from: Pt) {
  const d = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / d, uy = (tip.y - from.y) / d;
  const bx = tip.x - ux * ARROW, by = tip.y - uy * ARROW;
  return `M${tip.x.toFixed(1)},${tip.y.toFixed(1)}L${(bx - uy * 4.2).toFixed(1)},${(by + ux * 4.2).toFixed(1)}L${(bx + uy * 4.2).toFixed(1)},${(by - ux * 4.2).toFixed(1)}Z`;
}

/* ------------------------------------------------------------ hooks */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.floor(el.clientWidth));
    read();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/* ------------------------------------------------------------ views */
function Icon({ icon, size = 28 }: { icon?: string; size?: number }) {
  if (!icon) return null;
  return <span className="dk-diagram-ico" style={{ width: size, height: size }} aria-hidden>{icon}</span>;
}

function Detail({ c, sel, onPick }: { c: Clean; sel: number | null; onPick: (i: number) => void }) {
  if (sel == null) {
    return (
      <div className="dk-diagram-panel dk-diagram-panel--empty" aria-live="polite">
        <p>{"Select a node to see what it is and who it is connected to."}</p>
      </div>
    );
  }
  const n = c.nodes[sel];
  const links = c.edges
    .filter((e) => e.a === sel || e.b === sel)
    .map((e) => ({ other: e.a === sel ? e.b : e.a, dir: e.both ? '↔' : e.a === sel ? '→' : '←', label: e.label }));
  return (
    <div className="dk-diagram-panel" data-tone={n.tone} aria-live="polite">
      <div className="dk-diagram-panel-head">
        <Icon icon={n.icon} size={32} />
        <div>
          <h4>{n.label}</h4>
          {n.sub && <small>{n.sub}</small>}
        </div>
      </div>
      {n.detail ? <div className="dk-diagram-md">{md(n.detail)}</div> : null}
      {links.length > 0 && (
        <ul className="dk-diagram-rel" aria-label={"relation"}>
          {links.map((l, j) => (
            <li key={j}>
              <button type="button" data-tone={c.nodes[l.other].tone} onClick={() => onPick(l.other)}>
                <span className="dk-diagram-dir">{l.dir}</span>
                {c.nodes[l.other].label}
                {l.label && <em>{l.label}</em>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {n.href && linkHref(n.href) && <a className="dk-diagram-more" href={linkHref(n.href)!}>{"Open document →"}</a>}
    </div>
  );
}

function Wide({ c, L, sel, setSel }: { c: Clean; L: Layout; sel: number | null; setSel: (i: number | null) => void }) {
  const refs = useRef<(SVGGElement | null)[]>([]);
  const near = useMemo(() => {
    const s = new Set<number>();
    if (sel != null) c.edges.forEach((e) => { if (e.a === sel) s.add(e.b); if (e.b === sel) s.add(e.a); });
    return s;
  }, [c, sel]);

  const move = (i: number, key: string) => {
    const me = L.boxes[i];
    const dir = key === 'ArrowRight' ? [1, 0] : key === 'ArrowLeft' ? [-1, 0] : key === 'ArrowDown' ? [0, 1] : key === 'ArrowUp' ? [0, -1] : null;
    if (!dir) return false;
    let best = -1, score = Infinity;
    L.boxes.forEach((b, j) => {
      if (j === i) return;
      const dx = b.cx - me.cx, dy = b.cy - me.cy;
      const along = dx * dir[0] + dy * dir[1], across = Math.abs(dx * dir[1] + dy * dir[0]);
      if (along <= 1) return;
      const v = along + across * 2.2;
      if (v < score) { score = v; best = j; }
    });
    if (best >= 0) refs.current[best]?.focus();
    return true;
  };

  return (
    <svg
      className="dk-diagram-svg"
      width={L.W}
      height={L.H}
      viewBox={`0 0 ${L.W} ${L.H}`}
      role="group"
      aria-label={`Relationship graph,${c.nodes.length}nodes`}
      onClick={(e) => { if (e.target === e.currentTarget) setSel(null); }}
    >
      <g aria-hidden>
        {L.groups.map((g, i) => (
          <g key={i} className="dk-diagram-group" data-tone={g.tone}>
            <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={14} />
            <text x={g.x + 14} y={g.y + 19}>{fit(g.label, g.w - 28, 12, 600)}</text>
          </g>
        ))}
      </g>
      <g aria-hidden>
        {L.routes.map((r, i) => {
          const on = sel != null && (r.e.a === sel || r.e.b === sel);
          const off = sel != null && !on;
          const t = on ? c.nodes[sel!].tone : 'slate';
          const pts = trimmed(r.pts, Boolean(r.e.both), true);
          const n = r.pts.length;
          return (
            <g key={i} className="dk-diagram-edge" data-tone={t} data-state={on ? 'on' : off ? 'off' : undefined} data-dashed={r.e.dashed ? '' : undefined}>
              <path className="dk-diagram-line" d={roundPath(pts)} />
              <path className="dk-diagram-head" d={head(r.pts[n - 1], r.pts[n - 2])} />
              {r.e.both && <path className="dk-diagram-head" d={head(r.pts[0], r.pts[1])} />}
            </g>
          );
        })}
      </g>
      <g aria-hidden>
        {L.routes.map((r, i) => {
          if (!r.label) return null;
          const on = sel != null && (r.e.a === sel || r.e.b === sel);
          const off = sel != null && !on;
          const t = on ? c.nodes[sel!].tone : 'slate';
          return (
            <g key={i} className="dk-diagram-pill" data-tone={t} data-state={on ? 'on' : off ? 'off' : undefined}>
              <rect x={r.label.x - r.label.w / 2} y={r.label.y - 10} width={r.label.w} height={20} rx={10} />
              <text x={r.label.x} y={r.label.y + 4} textAnchor="middle">{r.label.text}</text>
            </g>
          );
        })}
      </g>
      {c.nodes.map((n, i) => {
        const b = L.boxes[i];
        const isSel = sel === i, dim = sel != null && !isSel && !near.has(i);
        const t = L.text[i], tx = b.x + t.tx;
        // centre this node's own text block vertically
        const blockH = t.label.length * 19 + (t.sub.length ? 3 + t.sub.length * 16 : 0);
        const y0 = b.cy - blockH / 2;
        return (
          <g
            key={n.id}
            ref={(el) => { refs.current[i] = el; }}
            className="dk-diagram-node" data-tone={n.tone} data-state={isSel ? 'sel' : dim ? 'dim' : near.has(i) ? 'near' : undefined}
            tabIndex={0}
            role="button"
            aria-pressed={isSel}
            aria-label={`${n.label}${n.sub ? `，${n.sub}` : ''}`}
            onFocus={() => setSel(i)}
            onClick={() => { setSel(i); refs.current[i]?.focus(); }}
            onKeyDown={(e) => {
              if (move(i, e.key)) e.preventDefault();
              else if (e.key === 'Escape') { setSel(null); (e.currentTarget as SVGGElement).blur(); }
            }}
          >
            <rect className="dk-diagram-focus" x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8} rx={13} />
            <rect className="dk-diagram-box" x={b.x} y={b.y} width={b.w} height={b.h} rx={10} />
            {n.icon && (
              <>
                <rect className="dk-diagram-badge" x={b.x + 10} y={b.cy - 14} width={28} height={28} rx={7} />
                <text className="dk-diagram-emoji" x={b.x + 24} y={b.cy + 5} textAnchor="middle">{n.icon}</text>
              </>
            )}
            {t.label.map((line, k) => <text key={`l${k}`} className="dk-diagram-label" x={tx} y={y0 + 14.5 + k * 19}>{line}</text>)}
            {t.sub.map((line, k) => <text key={`s${k}`} className="dk-diagram-sub" x={tx} y={y0 + t.label.length * 19 + 3 + 12 + k * 16}>{line}</text>)}
            <title>{n.label}{n.sub ? ` · ${n.sub}` : ''}</title>
          </g>
        );
      })}
    </svg>
  );
}

function List({ c, sel, setSel }: { c: Clean; sel: number | null; setSel: (i: number | null) => void }) {
  // Group members first (in group order), then ungrouped nodes.
  const sections: { label?: string; tone?: Tone; items: number[] }[] = [];
  const used = new Set<number>();
  for (const g of c.groups) {
    const items = c.nodes.map((n, i) => i).filter((i) => {
      const n = c.nodes[i];
      return !used.has(i) && n.col >= g.c0 && n.col <= g.c1 && n.row >= g.r0 && n.row <= g.r1;
    });
    items.forEach((i) => used.add(i));
    if (items.length) sections.push({ label: g.label, tone: g.tone, items });
  }
  const rest = c.nodes.map((_, i) => i).filter((i) => !used.has(i));
  if (rest.length) sections.push({ label: sections.length ? "other" : undefined, items: rest });

  return (
    <div className="dk-diagram-list">
      {sections.map((s, k) => (
        <section key={k} data-tone={s.tone}>
          {s.label && <h5>{s.label}</h5>}
          <ul>
            {s.items.map((i) => {
              const n = c.nodes[i];
              const out = c.edges.filter((e) => e.a === i || (e.both && e.b === i));
              const open = sel === i;
              return (
                <li key={n.id} className="dk-diagram-card" data-tone={n.tone} data-state={open ? 'sel' : undefined}>
                  <button type="button" aria-expanded={open} onClick={() => setSel(open ? null : i)}>
                    <Icon icon={n.icon} size={30} />
                    <span className="dk-diagram-card-text">
                      <b>{n.label}</b>
                      {n.sub && <small>{n.sub}</small>}
                    </span>
                    {(n.detail || n.href) && <span className="dk-diagram-chev" aria-hidden>{open ? '−' : '+'}</span>}
                  </button>
                  {out.length > 0 && (
                    <ul className="dk-diagram-conn">
                      {out.map((e, j) => {
                        const other = c.nodes[e.a === i ? e.b : e.a];
                        return (
                          <li key={j}>
                            <span className="dk-diagram-dir">{e.both ? '↔' : '→'}</span>
                            {e.both ? "and" : "Connect to"}<b>{other.label}</b>{e.both ? "Interoperability" : ''}
                            {e.label && <span className="dk-diagram-conn-l">（{e.label}）</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {open && (n.detail || n.href) && (
                    <div className="dk-diagram-card-body">
                      {n.detail && <div className="dk-diagram-md">{md(n.detail)}</div>}
                      {n.href && linkHref(n.href) && <a className="dk-diagram-more" href={linkHref(n.href)!}>{"Open document →"}</a>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function DocDiagram({ data }: { data: Data; onChange?: (d: Data) => void; readOnly: boolean }) {
  const c = useMemo(() => clean(data), [data]);
  const [ref, width] = useWidth();
  const init = useMemo(() => {
    const i = c.nodes.findIndex((n) => n.id === data?.initial);
    return i >= 0 ? i : null;
  }, [c, data?.initial]);
  const [sel, setSel] = useState<number | null>(init);
  const [seenInit, setSeenInit] = useState(init);
  if (seenInit !== init) { setSeenInit(init); setSel(init); }
  const safeSel = sel != null && sel < c.nodes.length ? sel : null;

  const L = useMemo(() => (width >= 640 ? layout(c, width) : null), [c, width]);
  const empty = !c.nodes.length;

  return (
    <div className="dk dk-diagram" ref={ref}>
      {(data?.caption || (!empty && L)) && (
        <div className="dk-diagram-top">
          {data?.caption ? <p className="dk-diagram-caption">{inline(data.caption, 'cap')}</p> : <span />}
          {!empty && L && <span className="dk-diagram-hint">{"Click on the node · Switch with the arrow keys"}</span>}
        </div>
      )}
      {empty ? (
        <div className="dk-diagram-empty">{"There are no nodes yet. exist"}<code>nodes</code>{"ribbon"}<code>col</code> / <code>row</code>{"After the node, a relationship diagram will be drawn here."}</div>
      ) : width === 0 ? null : L ? (
        <>
          <Wide c={c} L={L} sel={safeSel} setSel={setSel} />
          <Detail c={c} sel={safeSel} onPick={(i) => setSel(i)} />
        </>
      ) : (
        <List c={c} sel={safeSel} setSel={setSel} />
      )}
    </div>
  );
}

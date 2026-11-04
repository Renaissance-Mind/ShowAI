import { useId, useMemo, type KeyboardEvent, type ReactNode } from "react";
import type { BlockProps } from "./types";
import type {
  DrawingTone,
  MechanismData,
  MechanismLink,
  MechanismMark,
  MechanismNode,
  MechanismStep,
  MechanismZone,
  Side,
} from "./mechanism-contract.mjs";
import { BlockHeader, blockLabel } from "./shared";
import { InlineMarkup } from "./InlineMarkup";
import { NoteSvgText, noteProps } from "./NoteText";
import { plainNotes } from "./note-markup.mjs";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/mechanismDiagram";
import { isIndex, useReaderState } from "../../surface/reader-state";
import "./drawing-palette.css";
import "./mechanism-diagram.css";

const CELL_W = 180;
const CELL_H = 110;
const PAD = 16;
const INSET_X = 12;
const LABEL = 16;
const SMALL = 14;
const ROW_H = 26;
const FONT = "system-ui, -apple-system, 'PingFang SC', sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const WEIGHTS = { thin: 1.4, normal: 2, thick: 3.4 };

type Box = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };
type Route = {
  link: MechanismLink;
  points: Point[];
  ends: [Box, Box];
};

// SVG text cannot wrap, so labels are measured with the page font.
let context: CanvasRenderingContext2D | null | undefined;
function measure(value: string, size: number, mono = false, weight = 400) {
  if (context === undefined)
    context =
      typeof document === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d");
  if (context) {
    context.font = `${weight} ${size}px ${mono ? MONO : FONT}`;
    return context.measureText(value).width;
  }
  let width = 0;
  for (const char of value)
    width += /[\u2e80-\uffff]/.test(char) ? size : size * (mono ? 0.62 : 0.58);
  return width;
}
/** Up to two lines; the second ends with an ellipsis when it still overflows. */
function wrap(value: string, max: number, size: number, weight = 400) {
  const chars = Array.from(plainNotes(value));
  const lines: string[] = [];
  let line = "";
  for (const char of chars) {
    if (measure(line + char, size, false, weight) > max && line) {
      lines.push(line);
      line = char;
      if (lines.length === 2) break;
    } else line += char;
  }
  if (lines.length < 2) lines.push(line);
  else if (line && lines.join("").length < chars.length) {
    let last = lines[1];
    while (last && measure(`${last}…`, size, false, weight) > max)
      last = last.slice(0, -1);
    lines[1] = `${last}…`;
  }
  return lines.filter(Boolean);
}

const span = (item: { colSpan?: number; rowSpan?: number }) => ({
  cols: item.colSpan ?? 1,
  rows: item.rowSpan ?? 1,
});
function tableHeight(node: MechanismNode, rows: string[][]) {
  return (
    (node.table?.title || node.label ? 32 : 10) +
    (node.table?.columns ? ROW_H : 0) +
    ROW_H * Math.max(1, rows.length) +
    8
  );
}
function nodeBox(node: MechanismNode, rows: string[][]): Box {
  const { cols, rows: rowSpan } = span(node);
  const w = cols * CELL_W - 2 * INSET_X;
  const cellTop = PAD + node.row * CELL_H;
  const cellH = rowSpan * CELL_H;
  const h = node.table
    ? tableHeight(node, rows)
    : Math.min(
        cellH - 24,
        wrap(node.label ?? "", w - 20, LABEL, 600).length * 20 +
          (node.sub ? 20 : 0) +
          28,
      );
  return {
    x: PAD + node.col * CELL_W + INSET_X,
    y: node.table ? cellTop + 8 : cellTop + (cellH - h) / 2,
    w,
    h,
  };
}
const horizontal = (side: Side) => side === "left" || side === "right";
function chooseSides(a: Box, b: Box): [Side, Side] {
  const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
  const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
  const ax = a.x + a.w / 2,
    ay = a.y + a.h / 2,
    bx = b.x + b.w / 2,
    by = b.y + b.h / 2;
  if (overlapY && !overlapX)
    return bx > ax ? ["right", "left"] : ["left", "right"];
  if (overlapX || Math.abs(by - ay) >= Math.abs(bx - ax))
    return by > ay ? ["bottom", "top"] : ["top", "bottom"];
  return [bx > ax ? "right" : "left", by > ay ? "top" : "bottom"];
}
/** A side point; `center` moves it off the middle, e.g. into the span two boxes share. */
function anchor(box: Box, side: Side, offset: number, center?: number): Point {
  const x = (center ?? box.x + box.w / 2) + offset;
  const y = (center ?? box.y + box.h / 2) + offset;
  if (side === "top") return { x, y: box.y };
  if (side === "bottom") return { x, y: box.y + box.h };
  if (side === "left") return { x: box.x, y };
  return { x: box.x + box.w, y };
}
/** The middle of the span two boxes share along an axis, so the link runs straight. */
function shared(a: Box, b: Box, vertical: boolean) {
  const start = vertical ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
  const end = vertical
    ? Math.min(a.x + a.w, b.x + b.w)
    : Math.min(a.y + a.h, b.y + b.h);
  return end - start > 24 ? (start + end) / 2 : undefined;
}
function orthogonal(a: Point, sa: Side, b: Point, sb: Side): Point[] {
  if (horizontal(sa) && horizontal(sb)) {
    if (Math.abs(a.y - b.y) < 1) return [a, b];
    const x = (a.x + b.x) / 2;
    return [a, { x, y: a.y }, { x, y: b.y }, b];
  }
  if (!horizontal(sa) && !horizontal(sb)) {
    if (Math.abs(a.x - b.x) < 1) return [a, b];
    const y = (a.y + b.y) / 2;
    return [a, { x: a.x, y }, { x: b.x, y }, b];
  }
  return horizontal(sa)
    ? [a, { x: b.x, y: a.y }, b]
    : [a, { x: a.x, y: b.y }, b];
}
/**
 * Where a link label goes: the middle of the longest segment that can hold the
 * label; on a link too short for it, beside the link outside both boxes.
 */
function labelPoint(route: Route, width: number): Point {
  let best: { length: number; mid: Point; vertical: boolean } | null = null;
  let longest = { length: -1, mid: route.points[0], vertical: false };
  for (let i = 1; i < route.points.length; i++) {
    const p = route.points[i - 1],
      q = route.points[i];
    const vertical = Math.abs(q.x - p.x) < 1;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    if (length > longest.length) longest = { length, mid, vertical };
    const fits = vertical ? length >= 42 : length >= width + 16;
    if (fits && (!best || length > best.length))
      best = { length, mid, vertical };
  }
  if (best) return best.mid;
  const [a, b] = route.ends;
  return longest.vertical
    ? { x: longest.mid.x + width / 2 + 8, y: longest.mid.y }
    : { x: longest.mid.x, y: Math.min(a.y, b.y) - 18 };
}

/** Geometry for every element, computed once so steps never move anything. */
function arrange(model: MechanismData) {
  const boxes = new Map<string, Box>();
  for (const node of model.nodes) {
    const tallest = [node.table?.rows ?? []]
      .concat(
        (model.steps ?? []).flatMap((step) =>
          step.tables?.[node.id]?.rows ? [step.tables[node.id].rows!] : [],
        ),
      )
      .reduce((max, rows) => (rows.length > max.length ? rows : max), []);
    boxes.set(node.id, nodeBox(node, tallest));
  }
  const links = model.links ?? [];
  const sides = links.map((link) => {
    const [from, to] = chooseSides(boxes.get(link.from)!, boxes.get(link.to)!);
    return [link.fromSide ?? from, link.toSide ?? to] as [Side, Side];
  });
  // Links sharing a node side are spread along it instead of overlapping.
  const groups = new Map<string, number[]>();
  links.forEach((link, index) => {
    for (const [end, node] of [
      [0, link.from],
      [1, link.to],
    ] as const) {
      const key = `${node}|${sides[index][end]}`;
      groups.set(key, [...(groups.get(key) ?? []), index * 2 + end]);
    }
  });
  const offsets = new Map<number, number>();
  for (const [key, members] of groups) {
    const [node, side] = key.split("|") as [string, Side];
    const box = boxes.get(node)!;
    const length = horizontal(side) ? box.h : box.w;
    const gap = Math.min(22, length / (members.length + 1));
    members.forEach((member, i) =>
      offsets.set(member, (i - (members.length - 1) / 2) * gap),
    );
  }
  const routes: Route[] = links.map((link, index) => {
    const [sa, sb] = sides[index];
    const from = boxes.get(link.from)!,
      to = boxes.get(link.to)!;
    const center =
      horizontal(sa) === horizontal(sb)
        ? shared(from, to, !horizontal(sa))
        : undefined;
    // A straight link keeps one offset at both ends so it stays straight.
    const spread =
      center === undefined
        ? undefined
        : (offsets.get(index * 2)! + offsets.get(index * 2 + 1)!) / 2;
    const a = anchor(from, sa, spread ?? offsets.get(index * 2)!, center);
    const b = anchor(to, sb, spread ?? offsets.get(index * 2 + 1)!, center);
    return { link, points: orthogonal(a, sa, b, sb), ends: [from, to] };
  });
  let width = 0,
    height = 0;
  const grow = (x: number, y: number) => {
    width = Math.max(width, x);
    height = Math.max(height, y);
  };
  for (const box of boxes.values()) grow(box.x + box.w, box.y + box.h);
  for (const zone of model.zones ?? []) {
    const { cols, rows } = span(zone);
    grow(PAD + (zone.col + cols) * CELL_W, PAD + (zone.row + rows) * CELL_H);
  }
  for (const route of routes) {
    for (const point of route.points) grow(point.x, point.y);
    const text = [route.link.label]
      .concat((model.steps ?? []).map((step) => step.labels?.[route.link.id]))
      .filter((value): value is string => !!value);
    for (const value of text) {
      const width = measure(plainNotes(value), SMALL) + 20;
      const at = labelPoint(route, width);
      grow(at.x + width / 2, at.y + 13);
    }
  }
  return { boxes, routes, width: width + PAD, height: height + PAD };
}

type Frame = {
  step?: MechanismStep;
  visible: (item: { in?: string[] }) => boolean;
  dim: (id: string) => boolean;
  tone: (id: string, fallback: DrawingTone) => DrawingTone;
};
function frameFor(step: MechanismStep | undefined): Frame {
  const focus = step?.focus ? new Set(step.focus) : null;
  return {
    step,
    visible: (item) => !item.in || (!!step && item.in.includes(step.id)),
    dim: (id) => !!focus && !focus.has(id),
    tone: (id, fallback) => step?.tones?.[id] ?? fallback,
  };
}

function Pill({ at, text, tone }: { at: Point; text: string; tone: string }) {
  const width = measure(plainNotes(text), SMALL) + 20;
  return (
    <g className="md-pill" data-tone={tone}>
      <rect
        x={at.x - width / 2}
        y={at.y - 13}
        width={width}
        height={26}
        rx={13}
      />
      <text x={at.x} y={at.y + 5} textAnchor="middle">
        <NoteSvgText text={text} />
      </text>
    </g>
  );
}

function Diagram({
  model,
  layout,
  frame,
  prefix,
  label,
}: {
  model: MechanismData;
  layout: ReturnType<typeof arrange>;
  frame: Frame;
  prefix: string;
  label: string;
}) {
  const marker = (tone: string) => `url(#${prefix}-${tone})`;
  const tones = new Set<string>(["gray"]);
  for (const route of layout.routes)
    tones.add(frame.tone(route.link.id, route.link.tone ?? "gray"));
  const routeFor = new Map(
    layout.routes.map((route) => [route.link.id, route]),
  );
  // Labels shown together are nudged upward until they no longer overlap.
  const placed = new Map<string, Point>();
  const taken: Box[] = [];
  const clashes = (box: Box) =>
    taken.some(
      (other) =>
        box.x < other.x + other.w &&
        other.x < box.x + box.w &&
        box.y < other.y + other.h + 4 &&
        other.y < box.y + box.h + 4,
    );
  for (const route of layout.routes) {
    if (!frame.visible(route.link)) continue;
    const text = frame.step?.labels?.[route.link.id] ?? route.link.label;
    if (!text) continue;
    const width = measure(plainNotes(text), SMALL) + 20;
    const at = { ...labelPoint(route, width) };
    const box = () => ({ x: at.x - width / 2, y: at.y - 13, w: width, h: 26 });
    for (let tries = 0; tries < 4 && clashes(box()); tries++) at.y -= 30;
    taken.push(box());
    placed.set(route.link.id, at);
  }
  const markAt = (mark: MechanismMark): Point => {
    const box = layout.boxes.get(mark.on);
    if (box) return { x: box.x + box.w, y: box.y };
    const route = routeFor.get(mark.on)!;
    const text = frame.step?.labels?.[mark.on] ?? route.link.label;
    const width = text ? measure(plainNotes(text), SMALL) + 20 : 0;
    const at = placed.get(mark.on) ?? labelPoint(route, width);
    return { x: at.x + (text ? width / 2 + 16 : 0), y: at.y };
  };
  return (
    <svg
      className="md-svg"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-labelledby={`${prefix}-name`}
      style={{ minWidth: Math.min(layout.width, 600) }}
    >
      <desc id={`${prefix}-name`}>{label}</desc>
      <defs>
        {[...tones].map((tone) => (
          <marker
            key={tone}
            id={`${prefix}-${tone}`}
            data-tone={tone}
            className="md-head"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" />
          </marker>
        ))}
      </defs>
      {(model.zones ?? []).map((zone: MechanismZone) => {
        const { cols, rows } = span(zone);
        const x = PAD + zone.col * CELL_W + 4,
          y = PAD + zone.row * CELL_H + 4;
        return (
          <g key={zone.id} className="md-zone" data-tone={zone.tone}>
            <rect
              x={x}
              y={y}
              width={cols * CELL_W - 8}
              height={rows * CELL_H - 8}
              rx={12}
            />
            {zone.label && (
              <text x={x + 14} y={y + rows * CELL_H - 22}>
                <NoteSvgText text={zone.label} />
              </text>
            )}
          </g>
        );
      })}
      {layout.routes
        .filter((route) => frame.visible(route.link))
        .map(({ link, points }) => {
          const tone = frame.tone(link.id, link.tone ?? "gray");
          const ends = link.ends ?? "end";
          return (
            <path
              key={link.id}
              className={`md-link${frame.dim(link.id) ? " is-dim" : ""}`}
              data-tone={tone}
              d={`M ${points.map((p) => `${p.x} ${p.y}`).join(" L ")}`}
              strokeWidth={WEIGHTS[link.weight ?? "normal"]}
              strokeDasharray={link.style === "dashed" ? "6 5" : undefined}
              markerEnd={ends === "none" ? undefined : marker(tone)}
              markerStart={ends === "both" ? marker(tone) : undefined}
            />
          );
        })}
      {model.nodes.filter(frame.visible).map((node) => (
        <NodeShape
          key={node.id}
          node={node}
          box={layout.boxes.get(node.id)!}
          frame={frame}
        />
      ))}
      {layout.routes
        .filter((route) => frame.visible(route.link))
        .map((route) => {
          const { link } = route;
          const text = frame.step?.labels?.[link.id] ?? link.label;
          const at = text ? placed.get(link.id) : null;
          return text && at ? (
            <g
              key={link.id}
              className={frame.dim(link.id) ? "is-dim" : undefined}
            >
              <Pill
                at={at}
                text={text}
                tone={frame.tone(link.id, link.tone ?? "gray")}
              />
            </g>
          ) : null;
        })}
      {(model.marks ?? []).filter(frame.visible).map((mark) => {
        const at = markAt(mark);
        const tone = frame.tone(
          mark.id,
          mark.tone ?? (mark.kind === "check" ? "green" : "red"),
        );
        return (
          <g
            key={mark.id}
            className={`md-mark${frame.dim(mark.id) ? " is-dim" : ""}`}
            data-tone={tone}
          >
            <circle cx={at.x} cy={at.y} r={12} />
            <path
              d={
                mark.kind === "check"
                  ? `M ${at.x - 5.5} ${at.y} L ${at.x - 1.5} ${at.y + 4.5} L ${at.x + 6} ${at.y - 4.5}`
                  : `M ${at.x - 5} ${at.y - 5} L ${at.x + 5} ${at.y + 5} M ${at.x + 5} ${at.y - 5} L ${at.x - 5} ${at.y + 5}`
              }
            />
            {mark.label && (
              <text x={at.x + 18} y={at.y + 5}>
                <NoteSvgText text={mark.label} />
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function NodeShape({
  node,
  box,
  frame,
}: {
  node: MechanismNode;
  box: Box;
  frame: Frame;
}) {
  const tone = frame.tone(node.id, node.tone ?? (node.table ? "gray" : "blue"));
  const note = node.note ? noteProps(node.note) : null;
  const className = `md-node${node.table ? " md-table" : ""}${frame.dim(node.id) ? " is-dim" : ""}${note ? ` ${note.className}` : ""}`;
  const anchorProps = note
    ? { "data-showai-note": note["data-showai-note"], tabIndex: note.tabIndex }
    : {};
  if (!node.table) {
    const lines = wrap(node.label ?? "", box.w - 20, LABEL, 600);
    const total = lines.length * 20 + (node.sub ? 20 : 0);
    const top = box.y + (box.h - total) / 2 + 15;
    return (
      <g className={className} data-tone={tone} {...anchorProps}>
        <title>{plainNotes(node.label ?? "")}</title>
        <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={10} />
        {lines.map((line, i) => (
          <text
            key={i}
            className="md-label"
            x={box.x + box.w / 2}
            y={top + i * 20}
            textAnchor="middle"
          >
            {line}
          </text>
        ))}
        {node.sub && (
          <text
            className="md-sub"
            x={box.x + box.w / 2}
            y={top + lines.length * 20 + 1}
            textAnchor="middle"
          >
            <NoteSvgText text={node.sub} />
          </text>
        )}
      </g>
    );
  }
  const change = frame.step?.tables?.[node.id];
  const rows = change?.rows ?? node.table.rows ?? [];
  const highlight = change?.highlight;
  const heading = node.table.title ?? node.label;
  const columns = node.table.columns;
  const headTop = box.y + (heading ? 32 : 10);
  const y = headTop + (columns ? ROW_H : 0);
  const cells = (row: string[], at: number, header = false): ReactNode =>
    row.map((cell, i) => {
      const align =
        row.length === 1
          ? "start"
          : i === 0
            ? "start"
            : i === row.length - 1
              ? "end"
              : "middle";
      const x =
        align === "start"
          ? box.x + 12
          : align === "end"
            ? box.x + box.w - 12
            : box.x + (box.w * i) / (row.length - 1);
      return (
        <text
          key={i}
          className={header ? "md-head-cell" : "md-cell"}
          x={x}
          y={at + 17}
          textAnchor={align}
        >
          {cell}
        </text>
      );
    });
  return (
    <g className={className} data-tone={tone} {...anchorProps}>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={8} />
      {heading && (
        <text className="md-table-title" x={box.x + 12} y={box.y + 21}>
          <NoteSvgText text={heading} />
        </text>
      )}
      {columns && (
        <>
          {cells(columns, headTop, true)}
          <line
            className="md-rule"
            x1={box.x + 8}
            x2={box.x + box.w - 8}
            y1={y - 1}
            y2={y - 1}
          />
        </>
      )}
      {rows.length ? (
        rows.map((row, i) => (
          <g key={i}>
            {highlight === i && (
              <rect
                className="md-row-on"
                data-tone={change?.tone ?? "blue"}
                x={box.x + 4}
                y={y + i * ROW_H}
                width={box.w - 8}
                height={ROW_H - 2}
                rx={5}
              />
            )}
            {cells(row, y + i * ROW_H)}
          </g>
        ))
      ) : (
        <text
          className="md-empty"
          x={box.x + box.w / 2}
          y={y + 17}
          textAnchor="middle"
        >
          {node.table.empty ?? "—"}
        </text>
      )}
    </g>
  );
}

/**
 * Objects on a grid with the state they hold, the links between them and
 * steps that change only what differs. The layout is computed once, so every
 * step shows the same picture with different highlights.
 */
export function MechanismDiagramBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const model = data as unknown as MechanismData;
  const prefix = `md${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const layout = useMemo(() => arrange(model), [model]);
  const steps = model.steps ?? [];
  const initial = Math.max(
    0,
    steps.findIndex((step) => step.id === model.initialStep),
  );
  const [raw, setCurrent] = useReaderState("step", initial, {
    accept: isIndex,
  });
  const current = Math.min(raw, Math.max(0, steps.length - 1));
  const step = steps[current];
  const label = blockLabel(model.title, t("diagram"));
  const go = (index: number) =>
    setCurrent(Math.max(0, Math.min(steps.length - 1, index)));
  const keys = (event: KeyboardEvent) => {
    const next =
      event.key === "ArrowRight"
        ? current + 1
        : event.key === "ArrowLeft"
          ? current - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? steps.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    go(next);
  };
  return (
    <section className="sb-block md-block dw-palette" aria-label={label}>
      <BlockHeader title={model.title} description={model.description} />
      {steps.length > 0 && (
        <div
          className="md-steps"
          role="group"
          aria-label={t("steps")}
          onKeyDown={keys}
        >
          <ol>
            {steps.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={index === current}
                  aria-current={index === current ? "step" : undefined}
                  onClick={() => go(index)}
                >
                  <b>{index + 1}</b>
                  <span>{item.title}</span>
                </button>
              </li>
            ))}
          </ol>
          <span className="md-nav">
            <button
              type="button"
              aria-label={t("previous")}
              disabled={current === 0}
              onClick={() => go(current - 1)}
            >
              ←
            </button>
            <button
              type="button"
              aria-label={t("next")}
              disabled={current >= steps.length - 1}
              onClick={() => go(current + 1)}
            >
              →
            </button>
          </span>
        </div>
      )}
      <div className="md-live">
        <div className="md-scroll">
          <Diagram
            model={model}
            layout={layout}
            frame={frameFor(step)}
            prefix={`${prefix}-live`}
            label={step ? t("stepLabel", { label, title: step.title }) : label}
          />
        </div>
        {step?.text && (
          <div className="md-text" aria-live="polite">
            <InlineMarkup source={step.text} />
          </div>
        )}
      </div>
      {/* Printed pages cannot step through, so every step is drawn in turn. */}
      {steps.length > 0 && (
        <div className="md-print">
          {steps.map((item, index) => (
            <div key={item.id} className="md-print-step">
              <p className="md-print-title">
                {index + 1}. {item.title}
              </p>
              <Diagram
                model={model}
                layout={layout}
                frame={frameFor(item)}
                prefix={`${prefix}-p${index}`}
                label={t("stepLabel", { label, title: item.title })}
              />
              {item.text && (
                <div className="md-text">
                  <InlineMarkup source={item.text} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

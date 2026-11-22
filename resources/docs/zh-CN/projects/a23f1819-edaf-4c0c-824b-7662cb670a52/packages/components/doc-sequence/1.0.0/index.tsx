import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './style.css';

type Tone = 'brand' | 'teal' | 'warm' | 'violet' | 'rose' | 'slate';
type Actor = { id: string; label: string; sub?: string; icon?: string; tone?: Tone };
type Step = { from: string; to: string; label: string; detail?: string; kind?: 'call' | 'reply' | 'note' };
type Data = { actors: Actor[]; steps: Step[]; title?: string };

const TONES: Tone[] = ['brand', 'teal', 'warm', 'violet', 'rose', 'slate'];
const PLAY_MS = 1600;
const ROW = 46, NOTE_ROW = 46, SELF_ROW = 56;

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

/* ------------------------------------------------------------ data */
type CStep = Step & { kind: 'call' | 'reply' | 'note'; a: number; b: number };
type Clean = { actors: (Actor & { tone: Tone })[]; steps: CStep[]; skipped: string[] };
function clean(data: Data): Clean {
  const skipped: string[] = [];
  const seen = new Set<string>();
  const actors: Clean['actors'] = [];
  for (const a of Array.isArray(data?.actors) ? data.actors : []) {
    if (!a || typeof a.id !== 'string' || !a.label || seen.has(a.id)) { skipped.push(`actor ${a?.id ?? '?'}`); continue; }
    seen.add(a.id);
    actors.push({ ...a, tone: TONES.includes(a.tone as Tone) ? (a.tone as Tone) : 'brand' });
  }
  const index = new Map(actors.map((a, i) => [a.id, i]));
  const steps: CStep[] = [];
  for (const s of Array.isArray(data?.steps) ? data.steps : []) {
    const a = index.get(s?.from), b = index.get(s?.to);
    if (a == null || b == null || !s.label) { skipped.push(`step ${s?.from ?? '?'}→${s?.to ?? '?'}`); continue; }
    steps.push({ ...s, a, b, kind: s.kind === 'reply' || s.kind === 'note' ? s.kind : 'call' });
  }
  return { actors, steps, skipped };
}

export function readData(data: Data) {
  const c = clean(data);
  return {
    title: data?.title ?? null,
    actors: c.actors.map((a) => ({ id: a.id, label: a.label })),
    steps: c.steps.map((s, i) => ({ n: i + 1, from: c.actors[s.a].label, to: c.actors[s.b].label, label: s.label, kind: s.kind, hasDetail: Boolean(s.detail) })),
    skipped: c.skipped,
  };
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

/* ------------------------------------------------------------ icons (drawn, not emoji) */
const I = {
  prev: <svg viewBox="0 0 16 16" aria-hidden><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>,
  next: <svg viewBox="0 0 16 16" aria-hidden><path d="M6 3.5 10.5 8 6 12.5" /></svg>,
  play: <svg viewBox="0 0 16 16" aria-hidden><path className="f" d="M5 3.2v9.6L12.6 8z" /></svg>,
  pause: <svg viewBox="0 0 16 16" aria-hidden><path className="f" d="M4.5 3.5h2.4v9H4.5zM9.1 3.5h2.4v9H9.1z" /></svg>,
  reset: <svg viewBox="0 0 16 16" aria-hidden><path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3" /><path d="M4.6 2.2v2.7h2.7" /></svg>,
};

/* ------------------------------------------------------------ wide (svg) */
type RowGeo = { top: number; h: number; y: number };
function Wide({ c, W, cur, go }: { c: Clean; W: number; cur: number; go: (i: number) => void }) {
  const n = c.actors.length;
  const M = 4;
  const colW = (W - 2 * M) / n;
  const X = (i: number) => M + colW * (i + 0.5);
  const hasSub = c.actors.some((a) => a.sub);
  const hh = hasSub ? 58 : 42;
  const bw = Math.min(colW - 12, 176);
  const top0 = hh + 16;
  const rows: RowGeo[] = [];
  let y = top0;
  for (const s of c.steps) {
    const h = s.kind === 'note' ? NOTE_ROW : s.a === s.b ? SELF_ROW : ROW;
    rows.push({ top: y, h, y: y + 30 });
    y += h;
  }
  const H = y + 14;
  const step = c.steps[cur];
  const involved = new Set(step ? [step.a, step.b] : []);

  const badge = (x: number, cy: number, i: number) => (
    <g className="dk-sequence-num">
      <circle cx={x} cy={cy} r={10} />
      <text x={x} y={cy + 4} textAnchor="middle">{i + 1}</text>
    </g>
  );

  return (
    <svg
      className="dk-sequence-svg"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      tabIndex={0}
      role="group"
      aria-label={`时序图，共 ${c.steps.length} 步。左右方向键切换步骤。`}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (e.key === 'Home') { e.preventDefault(); go(0); return; }
        if (e.key === 'End') { e.preventDefault(); go(c.steps.length - 1); return; }
        if (!d) return;
        e.preventDefault();
        go(Math.max(0, Math.min(c.steps.length - 1, cur + d)));
      }}
    >
      {/* lifelines */}
      {c.actors.map((a, i) => (
        <line key={a.id} className="dk-sequence-life" data-tone={a.tone} data-on={involved.has(i) ? '' : undefined} x1={X(i)} x2={X(i)} y1={hh} y2={H - 4} />
      ))}
      {/* current row band */}
      {step && <rect className="dk-sequence-band" x={2} y={rows[cur].top + 3} width={W - 4} height={rows[cur].h - 6} rx={8} />}
      {/* actor headers */}
      {c.actors.map((a, i) => {
        const x = X(i);
        const iconW = a.icon ? 26 : 0;
        const label = fit(a.label, bw - 20 - iconW, 14, 600);
        const lw = textW(label, 14, 600) + iconW;
        const lx = x - lw / 2;
        const sub = a.sub ? fit(a.sub, bw - 16, 12) : '';
        const ly = a.sub ? 24 : hh / 2 + 5;
        return (
          <g key={a.id} className="dk-sequence-actor" data-tone={a.tone} data-on={involved.has(i) ? '' : undefined}>
            <rect x={x - bw / 2} y={1} width={bw} height={hh - 2} rx={10} />
            {a.icon && <text className="dk-sequence-emoji" x={lx + 9} y={ly} textAnchor="middle">{a.icon}</text>}
            <text className="dk-sequence-alabel" x={lx + iconW} y={ly}>{label}</text>
            {sub && <text className="dk-sequence-asub" x={x} y={ly + 19} textAnchor="middle">{sub}</text>}
            <title>{a.label}{a.sub ? ` · ${a.sub}` : ''}</title>
          </g>
        );
      })}
      {/* steps */}
      {c.steps.map((s, i) => {
        const r = rows[i];
        const state = i < cur ? 'done' : i === cur ? 'cur' : 'todo';
        const xa = X(s.a), xb = X(s.b);
        const fs = 13, fw = state === 'cur' ? 600 : 500;
        let body: React.ReactNode, hit: { x: number; w: number };
        if (s.kind === 'note') {
          const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
          const want = textW(s.label, fs, fw) + 52;
          let x0: number, x1: number;
          if (s.a === s.b) {
            // Single-actor note: centred on that lifeline, no wider than its column.
            const w = Math.min(want, colW - 8);
            x0 = lo - w / 2; x1 = lo + w / 2;
          } else {
            // Multi-actor note: spans its lifelines (wider when the label needs it), kept inside the diagram.
            x0 = lo - colW * 0.36; x1 = hi + colW * 0.36;
            if (x1 - x0 < want) { const mid = (lo + hi) / 2; x0 = mid - want / 2; x1 = mid + want / 2; }
            x0 = Math.max(4, x0); x1 = Math.min(W - 4, x1);
          }
          const label = fit(s.label, x1 - x0 - 52, fs, fw);
          const gw = 20 + 7 + textW(label, fs, fw), gx = (x0 + x1) / 2 - gw / 2;
          body = (
            <>
              <rect className="dk-sequence-note" x={x0} y={r.top + 8} width={x1 - x0} height={30} rx={6} />
              {badge(gx + 10, r.top + 23, i)}
              <text className="dk-sequence-label" x={gx + 27} y={r.top + 27.5}>{label}</text>
            </>
          );
          hit = { x: x0, w: x1 - x0 };
        } else if (s.a === s.b) {
          const right = xa + 44 + textW(s.label, fs, fw) + 30 < W - 4 || xa < W / 2;
          const d = right ? 1 : -1;
          const y1 = r.top + 16, y2 = r.top + 40, lx = xa + d * 30;
          const label = fit(s.label, (right ? W - 4 - (xa + 70) : xa - 70 - 4), fs, fw);
          const gw = 20 + 7 + textW(label, fs, fw);
          const gx = right ? xa + 44 : xa - 44 - gw;
          body = (
            <>
              <path className="dk-sequence-line" d={`M${xa},${y1}H${lx - d * 6}Q${lx},${y1} ${lx},${y1 + 6}V${y2 - 6}Q${lx},${y2} ${lx - d * 6},${y2}H${xa + d * 8}`} />
              <path className="dk-sequence-head" d={`M${xa + d * 1},${y2}l${d * 8},-4.5v9z`} />
              {badge(gx + 10, (y1 + y2) / 2, i)}
              <text className="dk-sequence-label" x={gx + 27} y={(y1 + y2) / 2 + 4.5}>{label}</text>
            </>
          );
          hit = { x: right ? xa - 8 : gx - 4, w: (right ? gx + gw + 8 : xa + 8) - (right ? xa - 8 : gx - 4) };
        } else {
          const d = xb > xa ? 1 : -1;
          const x1 = xa + d * 2, x2 = xb - d * 2;
          const span = Math.abs(xb - xa);
          const label = fit(s.label, Math.max(84, span + colW * 0.4 - 36), fs, fw);
          const gw = 20 + 7 + textW(label, fs, fw);
          let gx = (xa + xb) / 2 - gw / 2;
          gx = Math.max(4, Math.min(W - 4 - gw, gx));
          const reply = s.kind === 'reply';
          body = (
            <>
              <path className="dk-sequence-line" data-reply={reply ? '' : undefined} d={`M${x1},${r.y}H${x2 - d * (reply ? 1 : 7)}`} />
              {reply
                ? <path className="dk-sequence-open" d={`M${x2 - d * 8},${r.y - 5}L${x2},${r.y}L${x2 - d * 8},${r.y + 5}`} />
                : <path className="dk-sequence-head" d={`M${x2},${r.y}l${-d * 8},-4.5v9z`} />}
              {badge(gx + 10, r.y - 15, i)}
              <text className="dk-sequence-label" x={gx + 27} y={r.y - 10.5}>{label}</text>
            </>
          );
          hit = { x: Math.min(xa, xb, gx) - 6, w: Math.max(xa, xb, gx + gw) - Math.min(xa, xb, gx) + 12 };
        }
        return (
          <g key={i} className="dk-sequence-step" data-state={state} data-kind={s.kind} onClick={() => go(i)}>
            <rect className="dk-sequence-hit" x={hit.x} y={r.top + 2} width={hit.w} height={r.h - 4} />
            {body}
            <title>{`${i + 1}. ${c.actors[s.a].label} → ${c.actors[s.b].label}：${s.label}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------ narrow (list) */
function ActorChip({ a }: { a: Clean['actors'][number] }) {
  return <span className="dk-sequence-chip" data-tone={a.tone}>{a.icon && <span aria-hidden>{a.icon}</span>}{a.label}</span>;
}
function List({ c, cur, go }: { c: Clean; cur: number; go: (i: number) => void }) {
  return (
    <ol className="dk-sequence-list">
      {c.steps.map((s, i) => {
        const state = i < cur ? 'done' : i === cur ? 'cur' : 'todo';
        return (
          <li key={i} data-state={state} data-kind={s.kind}>
            <button type="button" aria-current={i === cur ? 'step' : undefined} onClick={() => go(i)}>
              <span className="dk-sequence-lnum">{i + 1}</span>
              <span className="dk-sequence-lbody">
                <span className="dk-sequence-route">
                  <ActorChip a={c.actors[s.a]} />
                  {s.a !== s.b && <><span className="dk-sequence-arrow" data-kind={s.kind}>{s.kind === 'note' ? '·' : '→'}</span><ActorChip a={c.actors[s.b]} /></>}
                  {s.kind === 'reply' && <em>返回</em>}
                  {s.kind === 'note' && <em>备注</em>}
                </span>
                <span className="dk-sequence-ltitle">{s.label}</span>
              </span>
            </button>
            {i === cur && s.detail && <div className="dk-sequence-ldetail">{md(s.detail)}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------ main */
export default function DocSequence({ data }: { data: Data; onChange?: (d: Data) => void; readOnly: boolean }) {
  const c = useMemo(() => clean(data), [data]);
  const [ref, width] = useWidth();
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const total = c.steps.length;
  const at = Math.min(cur, Math.max(0, total - 1));

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setCur((v) => Math.min(v + 1, total - 1)), PLAY_MS);
    return () => clearInterval(t);
  }, [playing, total]);
  useEffect(() => { if (playing && at >= total - 1) setPlaying(false); }, [at, playing, total]);

  const go = (i: number) => { setPlaying(false); setCur(Math.max(0, Math.min(total - 1, i))); };
  const play = () => {
    if (playing) { setPlaying(false); return; }
    if (at >= total - 1) setCur(0);
    setPlaying(true);
  };

  if (!c.actors.length || !total) {
    return (
      <div className="dk dk-sequence" ref={ref}>
        {data?.title && <div className="dk-sequence-top"><h4>{data.title}</h4></div>}
        <div className="dk-sequence-empty">
          {!c.actors.length ? <>还没有参与者。在 <code>actors</code> 里加入参与者，再用 <code>steps</code> 描述他们之间的消息。</> : <>还没有步骤。在 <code>steps</code> 里用参与者 id 写出 <code>from</code> → <code>to</code> 的消息。</>}
        </div>
      </div>
    );
  }

  const narrow = width > 0 && (width < 640 || (width - 8) / c.actors.length < 96);
  const s = c.steps[at];
  const controls = (
    <div className="dk-sequence-bar">
      <div className="dk-sequence-btns" role="group" aria-label="步骤控制">
        <button type="button" onClick={() => go(at - 1)} disabled={at === 0}>{I.prev}<span>上一步</span></button>
        <button type="button" onClick={() => go(at + 1)} disabled={at >= total - 1}>{I.next}<span>下一步</span></button>
        <button type="button" className="dk-sequence-play" aria-pressed={playing} onClick={play}>{playing ? I.pause : I.play}<span>{playing ? '暂停' : '播放'}</span></button>
        <button type="button" onClick={() => go(0)} disabled={at === 0 && !playing}>{I.reset}<span>重来</span></button>
      </div>
      <span className="dk-sequence-count" aria-live="polite">第 <b>{at + 1}</b> / {total} 步</span>
    </div>
  );
  const progress = <div className="dk-sequence-progress" aria-hidden><i style={{ width: `${((at + 1) / total) * 100}%` }} /></div>;

  return (
    <div className="dk dk-sequence" ref={ref}>
      {(data?.title || !narrow) && (
        <div className="dk-sequence-top">
          {data?.title ? <h4>{data.title}</h4> : <span />}
          {!narrow && <span className="dk-sequence-hint">点击箭头跳到该步 · 方向键切换</span>}
        </div>
      )}
      {width === 0 ? null : narrow ? (
        <>
          <div className="dk-sequence-cast">{c.actors.map((a) => <ActorChip key={a.id} a={a} />)}</div>
          <div className="dk-sequence-panel dk-sequence-panel--bar">{controls}{progress}</div>
          <List c={c} cur={at} go={go} />
        </>
      ) : (
        <>
          <Wide c={c} W={width} cur={at} go={go} />
          <div className="dk-sequence-panel">
            {controls}
            {progress}
            <div className="dk-sequence-detail" aria-live="polite">
              <div className="dk-sequence-meta">
                <span className="dk-sequence-lnum">{at + 1}</span>
                <ActorChip a={c.actors[s.a]} />
                {s.a !== s.b && <><span className="dk-sequence-arrow" data-kind={s.kind}>{s.kind === 'note' ? '·' : '→'}</span><ActorChip a={c.actors[s.b]} /></>}
                {s.kind === 'reply' && <em>返回</em>}
                {s.kind === 'note' && <em>备注</em>}
              </div>
              <h5>{s.label}</h5>
              {s.detail && <div className="dk-sequence-md">{md(s.detail)}</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

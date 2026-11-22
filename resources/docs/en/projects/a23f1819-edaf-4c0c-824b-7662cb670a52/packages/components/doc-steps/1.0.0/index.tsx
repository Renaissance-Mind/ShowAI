import React, { useEffect, useRef, useState } from 'react';
import './style.css';

type Variant = { label: string; code: string };
type Step = { title: string; body?: string; code?: string; lang?: string; variants?: Variant[]; note?: string; result?: string };
type Data = { steps: Step[]; start?: number };

// ---------------------------------------------------------------- shared markdown-lite (kept identical across the docs kit)
const DOCS = 'https://showai.renaissancemind.ai/doc';
/** `doc:slug#anchor` -> canonical docs URL; script URLs are dropped; anything else passes through. */
export function href(target: string) {
  const t = target.trim();
  if (/^(javascript|data|vbscript):/i.test(t)) return '#';
  if (!t.startsWith('doc:')) return t;
  const [slug, anchor] = t.slice(4).split('#');
  return DOCS + (slug ? `/${slug}` : '') + (anchor ? `#${anchor}` : '');
}
const TOKEN = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
/** **bold**, `code`, [label](href) -> React nodes. `links: false` renders link labels as text (inside another link). */
export function md(src: string, links = true, k = 'm'): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = new RegExp(TOKEN.source, 'g');
  let pos = 0, i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > pos) out.push(src.slice(pos, m.index));
    const key = `${k}.${i++}`;
    if (m[1] !== undefined) out.push(<strong key={key}>{md(m[1], links, key)}</strong>);
    else if (m[2] !== undefined) out.push(<code key={key}>{m[2]}</code>);
    else if (links) out.push(<a key={key} href={href(m[4])}>{md(m[3], false, key)}</a>);
    else out.push(<span key={key}>{md(m[3], false, key)}</span>);
    pos = re.lastIndex;
  }
  if (pos < src.length) out.push(src.slice(pos));
  return out;
}
const plain = (s: string) => s.replace(TOKEN, (_, b, c, l) => b ?? c ?? l ?? '');

export function readData(data: Data) {
  const start = data.start ?? 1;
  return {
    count: data.steps.length,
    steps: data.steps.map((s, i) => ({
      number: start + i,
      title: s.title,
      body: s.body ? plain(s.body) : null,
      code: s.variants?.length ? null : s.code ?? null,
      variants: s.variants?.map((v) => ({ label: v.label, code: v.code })) ?? null,
      note: s.note ? plain(s.note) : null,
      result: s.result ? plain(s.result) : null,
    })),
  };
}

// ---------------------------------------------------------------- copy (Clipboard API is denied in the sandbox)
function copyText(text: string, fallback: HTMLElement | null): boolean {
  let ok = false;
  const active = document.activeElement as HTMLElement | null;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    ok = document.execCommand('copy');
    document.body.removeChild(ta);
  } catch {
    ok = false;
  }
  active?.focus?.({ preventScroll: true });
  if (!ok && fallback) {
    const range = document.createRange();
    range.selectNodeContents(fallback);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  return ok;
}

const isComment = (line: string, lang?: string) => {
  const t = line.trimStart();
  if (t.startsWith('//')) return true;
  return t.startsWith('#') && !/^(md|markdown)$/i.test(lang ?? '') && !t.startsWith('#!');
};

function CodePanel({ step, index }: { step: Step; index: number }) {
  const variants = step.variants?.length ? step.variants : null;
  const [tab, setTab] = useState(0);
  const [status, setStatus] = useState<'idle' | 'copied' | 'selected'>('idle');
  const codeRef = useRef<HTMLElement>(null);
  const timer = useRef<number>();
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const active = variants ? variants[Math.min(tab, variants.length - 1)] : null;
  const code = (active ? active.code : step.code ?? '').replace(/\n+$/, '');

  const onCopy = () => {
    const ok = copyText(code, codeRef.current);
    setStatus(ok ? 'copied' : 'selected');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus('idle'), ok ? 1500 : 4000);
  };
  const onTabKey = (e: React.KeyboardEvent) => {
    if (!variants) return;
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (tab + d + variants.length) % variants.length;
    setTab(next);
    setStatus('idle');
    (tabsRef.current?.children[next] as HTMLElement | undefined)?.focus();
  };
  const panelId = `dk-steps-code-${index}`;

  return (
    <div className="dk-steps-code">
      <div className="dk-steps-codebar">
        {variants ? (
          <div className="dk-steps-tabs" role="tablist" aria-label={"Choose environment"} ref={tabsRef} onKeyDown={onTabKey}>
            {variants.map((v, i) => (
              <button key={i} type="button" role="tab" aria-selected={i === tab} aria-controls={panelId}
                tabIndex={i === tab ? 0 : -1} onClick={() => { setTab(i); setStatus('idle'); }}>
                {v.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="dk-steps-lang">{step.lang || 'shell'}</span>
        )}
        <span className="dk-steps-hint" aria-live="polite">{status === 'selected' ? "Selected, press ⌘C / Ctrl+C to copy" : ''}</span>
        <button type="button" className={`dk-steps-copy${status === 'copied' ? ' is-ok' : ''}`} onClick={onCopy}
          aria-label={status === 'copied' ? "Copied" : `Copy the code for step${index}`}>
          {status === 'copied' ? (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" /></svg>
          )}
          <span>{status === 'copied' ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre id={panelId} role={variants ? 'tabpanel' : undefined} tabIndex={0} aria-label={"code"}>
        <code ref={codeRef}>
          {code.split('\n').map((line, i) => (
            <span key={i} className={isComment(line, active ? undefined : step.lang) ? 'c' : undefined}>{line}{'\n'}</span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export default function DocSteps({ data }: { data: Data; onChange?: (d: Data) => void; readOnly: boolean }) {
  const start = data.start ?? 1;
  const n = data.steps.length;
  const [done, setDone] = useState<boolean[]>(() => data.steps.map(() => false));
  useEffect(() => { setDone((d) => data.steps.map((_, i) => d[i] ?? false)); }, [n]);
  const count = done.filter(Boolean).length;
  const toggle = (i: number) => setDone((d) => d.map((v, j) => (j === i ? !v : v)));

  return (
    <div className="dk dk-steps">
      {n > 1 && (
        <div className="dk-steps-progress">
          <span className="dk-steps-count" aria-live="polite">
            {count === n ? "All done" : <>{"Completed "}<b>{count}</b> / {n}{" steps"}</>}
          </span>
          <span className="dk-steps-bar" aria-hidden="true"><i style={{ width: `${(count / n) * 100}%` }} /></span>
          {count > 0
            ? <button type="button" className="dk-steps-reset" onClick={() => setDone(data.steps.map(() => false))}>{"reset"}</button>
            : <span className="dk-steps-tip">{"Click the serial number mark to complete"}</span>}
        </div>
      )}
      <ol className="dk-steps-list">
        {data.steps.map((s, i) => {
          const num = start + i;
          const isDone = !!done[i];
          return (
            <li key={i} className={`dk-steps-step${isDone ? ' is-done' : ''}`}>
              <div className="dk-steps-rail">
                <button type="button" className="dk-steps-num" aria-pressed={isDone}
                  aria-label={isDone ? `Step${num}completed, click Cancel` : `Mark step${num}as completed`} onClick={() => toggle(i)}>
                  {isDone
                    ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.8 8.4l2.8 2.8 5.6-6.4" /></svg>
                    : num}
                </button>
                {i < n - 1 && <span className="dk-steps-line" aria-hidden="true" />}
              </div>
              <div className="dk-steps-content">
                <h3 className="dk-steps-title">{md(s.title)}</h3>
                {s.body && s.body.split(/\n+/).filter(Boolean).map((p, j) => <p key={j} className="dk-steps-body">{md(p)}</p>)}
                {(s.code || s.variants?.length) && <CodePanel step={s} index={num} />}
                {s.note && (
                  <p className="dk-steps-note">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" /><path d="M8 7.2v3.6M8 5.1v.1" /></svg>
                    <span>{md(s.note)}</span>
                  </p>
                )}
                {s.result && (
                  <p className="dk-steps-result">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" /><path d="M4.9 8.2l2.1 2.1 4.1-4.5" /></svg>
                    <span>{md(s.result)}</span>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

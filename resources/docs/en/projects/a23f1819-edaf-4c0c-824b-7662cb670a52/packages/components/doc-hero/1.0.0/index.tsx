import React from 'react';
import './style.css';

type Art = 'start' | 'concepts' | 'workbench' | 'agent' | 'collab' | 'dev' | 'none';
type Data = {
  eyebrow?: string;
  title: string;
  lead: string;
  facts?: { label: string; value: string }[];
  actions?: { label: string; href: string; primary?: boolean }[];
  art?: Art;
};

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
  return {
    title: data.title,
    eyebrow: data.eyebrow ?? null,
    lead: plain(data.lead),
    facts: (data.facts ?? []).map((f) => `${f.label}: ${plain(f.value)}`),
    actions: (data.actions ?? []).map((a) => ({ label: a.label, href: href(a.href), primary: !!a.primary })),
    art: data.art ?? 'start',
  };
}

// ---------------------------------------------------------------- illustrations (220 x 150, token-coloured via classes)
// Classes: p = paper sheet, l = text line, k = heading line, f-<tone> = soft fill, s-<tone> = tone stroke, c-<tone> = solid tone fill.
const Lines = ({ x, y, w, gap = 8 }: { x: number; y: number; w: number[]; gap?: number }) => (
  <>{w.map((v, i) => <rect key={i} className="l" x={x} y={y + i * gap} width={v} height={4} rx={2} />)}</>
);

function ArtStart() {
  return (
    <g>
      <rect className="p ghost" x={66} y={20} width={96} height={116} rx={7} transform="rotate(-7 114 78)" />
      <rect className="p ghost" x={66} y={18} width={96} height={116} rx={7} transform="rotate(5 114 76)" />
      <rect className="p" x={62} y={17} width={96} height={116} rx={7} />
      <rect className="k" x={74} y={30} width={44} height={6} rx={3} />
      <Lines x={74} y={43} w={[70, 56]} />
      <rect className="f-teal" x={74} y={63} width={72} height={36} rx={5} />
      {[10, 18, 13, 24, 19].map((h, i) => (
        <rect key={i} className="c-teal" x={82 + i * 12} y={93 - h} width={6} height={h} rx={1.5} />
      ))}
      <Lines x={74} y={107} w={[66, 44]} />
      <circle className="c-brand" cx={157} cy={124} r={13} />
      <path className="on" d="M157 118.5v11M151.5 124h11" />
      <path className="s-brand" d="M38 40v10M33 45h10" />
      <path className="s-warm" d="M186 34v8M182 38h8" />
      <circle className="c-violet" cx={36} cy={104} r={3} />
      <circle className="c-teal dim" cx={190} cy={96} r={2.5} />
    </g>
  );
}

function ArtConcepts() {
  const pages = [
    { y: 16, tone: 'brand' }, { y: 60, tone: 'teal' }, { y: 104, tone: 'warm' },
  ];
  return (
    <g>
      {pages.map((p) => (
        <path key={p.y} className="edge" d={`M64 75 C 84 75, 82 ${p.y + 15}, 100 ${p.y + 15}`} />
      ))}
      {pages.map((p) => (
        <g key={`b${p.y}`}>
          <path className="edge" d={`M146 ${p.y + 15} C 156 ${p.y + 15}, 156 ${p.y + 8}, 166 ${p.y + 8}`} />
          <path className="edge" d={`M146 ${p.y + 15} C 156 ${p.y + 15}, 156 ${p.y + 22}, 166 ${p.y + 22}`} />
        </g>
      ))}
      <rect className="f-brand s-brand" x={18} y={56} width={46} height={38} rx={9} />
      <rect className="c-brand" x={28} y={66} width={14} height={4} rx={2} />
      <rect className="c-brand dim" x={28} y={74} width={26} height={3.5} rx={1.75} />
      <rect className="c-brand dim" x={28} y={80} width={20} height={3.5} rx={1.75} />
      {pages.map((p) => (
        <g key={`p${p.y}`}>
          <rect className="p" x={100} y={p.y} width={46} height={30} rx={6} />
          <rect className={`c-${p.tone}`} x={108} y={p.y + 8} width={16} height={4} rx={2} />
          <rect className="l" x={108} y={p.y + 17} width={28} height={3.5} rx={1.75} />
          <rect className={`f-${p.tone} s-${p.tone}`} x={166} y={p.y + 3} width={30} height={10} rx={3} />
          <rect className={`f-${p.tone}`} x={166} y={p.y + 17} width={22} height={10} rx={3} />
        </g>
      ))}
    </g>
  );
}

function ArtWorkbench() {
  return (
    <g>
      <rect className="p" x={12} y={14} width={196} height={122} rx={8} />
      <path className="edge" d="M12 30h196M56 30v106" />
      {[22, 29, 36].map((x) => <circle key={x} className="dot" cx={x} cy={22} r={2.2} />)}
      <rect className="f-brand" x={18} y={46} width={33} height={9} rx={2.5} />
      <Lines x={21} y={38} w={[26]} />
      <rect className="c-brand" x={21} y={48.5} width={22} height={4} rx={2} />
      <Lines x={21} y={60} w={[28, 18, 24, 14]} />
      <rect className="k" x={66} y={40} width={52} height={6} rx={3} />
      <rect className="f-warm" x={66} y={54} width={60} height={42} rx={5} />
      {[14, 22, 17, 28].map((h, i) => (
        <rect key={i} className="c-warm" x={74 + i * 12} y={89 - h} width={7} height={h} rx={1.5} />
      ))}
      <Lines x={66} y={104} w={[58, 46, 52]} />
      <Lines x={136} y={56} w={[60, 48]} />
      <rect className="f-brand s-brand" x={134} y={74} width={64} height={48} rx={5} />
      <circle className="s-brand thick" cx={152} cy={98} r={9} />
      <path className="s-brand thick" d="M152 89a9 9 0 0 1 8.5 12" />
      <rect className="c-brand dim" x={168} y={92} width={22} height={3.5} rx={1.75} />
      <rect className="c-brand dim" x={168} y={100} width={16} height={3.5} rx={1.75} />
      {[[134, 74], [198, 74], [134, 122], [198, 122]].map(([x, y]) => (
        <rect key={`${x}${y}`} className="handle" x={x - 2.5} y={y - 2.5} width={5} height={5} rx={1} />
      ))}
    </g>
  );
}

function ArtAgent() {
  return (
    <g>
      <rect className="f-slate" x={14} y={22} width={74} height={24} rx={11} />
      <rect className="k soft" x={24} y={32} width={52} height={4} rx={2} />
      <rect className="f-violet s-violet" x={26} y={56} width={84} height={32} rx={12} />
      {[50, 60, 70].map((x, i) => <circle key={x} className="c-violet" style={{ opacity: 1 - i * 0.25 }} cx={x} cy={72} r={3} />)}
      <rect className="f-slate" x={14} y={98} width={58} height={22} rx={11} />
      <rect className="k soft" x={24} y={107} width={36} height={4} rx={2} />
      <path className="s-violet dash" d="M112 72 C 122 72, 122 76, 132 76" />
      <path className="s-violet" d="M128 72.5l4.5 3.5-4.5 3.5" />
      <rect className="p" x={138} y={16} width={72} height={118} rx={8} />
      <rect className="k" x={148} y={27} width={34} height={5} rx={2.5} />
      <circle className="ring" cx={163} cy={56} r={13} />
      <path className="s-violet thick" d="M163 43a13 13 0 0 1 12.4 17" />
      <Lines x={182} y={50} w={[18, 12]} />
      <rect className="f-brand" x={148} y={78} width={25} height={20} rx={4} />
      <rect className="f-teal" x={177} y={78} width={25} height={20} rx={4} />
      <rect className="f-warm" x={148} y={102} width={25} height={20} rx={4} />
      <rect className="f-violet" x={177} y={102} width={25} height={20} rx={4} />
    </g>
  );
}

function ArtCollab() {
  return (
    <g>
      <path className="s-teal dash" d="M96 46 C 70 52, 56 60, 52 72" />
      <path className="s-teal dash" d="M124 46 C 150 52, 164 58, 168 70" />
      <path className="s-teal" d="M49 67.5l3 5 3.8-4.4M165.5 65.5l2.6 5.1 4-4.2" />
      <circle className="f-teal s-teal" cx={110} cy={38} r={18} />
      <rect className="c-teal" x={101} y={31} width={18} height={3.5} rx={1.75} />
      <rect className="c-teal dim" x={101} y={37} width={18} height={3.5} rx={1.75} />
      <rect className="c-teal dim" x={101} y={43} width={12} height={3.5} rx={1.75} />
      <rect className="p" x={20} y={78} width={66} height={42} rx={4} />
      <path className="p" d="M12 124h82l-5 6H17z" />
      <rect className="k" x={28} y={86} width={26} height={4.5} rx={2.25} />
      <rect className="f-brand" x={28} y={95} width={24} height={17} rx={3} />
      <Lines x={57} y={96} w={[22, 16, 20]} gap={6} />
      <rect className="p" x={148} y={72} width={40} height={64} rx={7} />
      <rect className="k" x={155} y={82} width={18} height={4.5} rx={2.25} />
      <rect className="f-brand" x={155} y={91} width={26} height={17} rx={3} />
      <Lines x={155} y={113} w={[26, 18]} gap={6} />
      <circle className="c-warm" cx={80} cy={76} r={6} />
      <circle className="c-violet" cx={186} cy={70} r={6} />
      <circle className="avatar" cx={80} cy={76} r={6} />
      <circle className="avatar" cx={186} cy={70} r={6} />
      <path className="c-warm" d="M57 103l8 3-3.4 1.3-1.4 3.4z" />
    </g>
  );
}

function ArtDev() {
  return (
    <g>
      <rect className="p" x={12} y={18} width={110} height={114} rx={8} />
      <path className="edge" d="M12 33h110" />
      {[21, 28, 35].map((x) => <circle key={x} className="dot" cx={x} cy={25.5} r={2.2} />)}
      {[
        [[22, 14, 'violet'], [40, 30, 'l']],
        [[30, 18, 'teal'], [52, 24, 'l']],
        [[30, 12, 'warm'], [46, 40, 'l']],
        [[38, 28, 'l'], [70, 16, 'violet']],
        [[30, 20, 'teal'], [54, 30, 'l']],
        [[22, 10, 'violet']],
        [[22, 30, 'l'], [56, 20, 'brand']],
      ].map((row, r) =>
        row.map(([x, w, t], i) => (
          <rect key={`${r}.${i}`} className={t === 'l' ? 'l' : `c-${t} dim`} x={x as number} y={44 + r * 11} width={w as number} height={4} rx={2} />
        )),
      )}
      <path className="s-brand dash" d="M126 75h12" />
      <path className="s-brand" d="M135 71.5l4 3.5-4 3.5" />
      <path className="s-violet thick" d="M154 50l-10 25 10 25M200 50l10 25-10 25" />
      <rect className="f-brand s-brand" x={156} y={46} width={42} height={58} rx={6} />
      <rect className="c-brand" x={163} y={54} width={16} height={4} rx={2} />
      <path className="s-brand" d="M163 70h28" />
      <circle className="c-brand" cx={176} cy={70} r={3.5} />
      {[9, 15, 11, 19].map((h, i) => (
        <rect key={i} className="c-brand dim" x={164 + i * 7} y={96 - h} width={4.5} height={h} rx={1} />
      ))}
    </g>
  );
}

const ARTS: Record<Exclude<Art, 'none'>, () => React.ReactElement> = {
  start: ArtStart, concepts: ArtConcepts, workbench: ArtWorkbench, agent: ArtAgent, collab: ArtCollab, dev: ArtDev,
};

export default function DocHero({ data }: { data: Data; onChange?: (d: Data) => void; readOnly: boolean }) {
  const art = data.art ?? 'start';
  const Illustration = art === 'none' ? null : ARTS[art] ?? ArtStart;
  const facts = (data.facts ?? []).slice(0, 4);
  const actions = (data.actions ?? []).slice(0, 3);
  return (
    <header className={`dk dk-hero${Illustration ? '' : ' dk-hero--plain'}`}>
      <div className="dk-hero-main">
        <div className="dk-hero-text">
          {data.eyebrow && <p className="dk-hero-eyebrow">{data.eyebrow}</p>}
          <h1 className="dk-hero-title">{data.title}</h1>
          <p className="dk-hero-lead">{md(data.lead)}</p>
          {actions.length > 0 && (
            <div className="dk-hero-actions">
              {actions.map((a, i) => (
                <a key={i} className={`dk-hero-btn${a.primary ? ' is-primary' : ''}`} href={href(a.href)}>
                  {a.label}
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9M8.5 4l4 4-4 4" /></svg>
                </a>
              ))}
            </div>
          )}
        </div>
        {Illustration && (
          <div className="dk-hero-art" aria-hidden="true">
            <svg viewBox="0 0 220 150"><Illustration /></svg>
          </div>
        )}
      </div>
      {facts.length > 0 && (
        <dl className="dk-hero-facts">
          {facts.map((f, i) => (
            <div key={i} className="dk-hero-fact">
              <dt>{f.label}</dt>
              <dd>{md(f.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

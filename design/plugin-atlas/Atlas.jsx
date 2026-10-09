import React, { useState, useEffect, useRef, useId } from "react";
import {
  Compass,
  FileText,
  Layers,
  PanelsTopLeft,
  Terminal,
  Settings2,
  SquareArrowOutUpRight,
  ArrowRight,
  Info,
  Folder,
  Search,
  Code,
  Check,
  Copy,
  X,
  BookOpen,
  ChevronRight,
  Package,
  FileJson,
  Workflow,
  UserRound,
} from "lucide-react";
import css from "./atlas.css";
const icons = {
  compass: Compass,
  document: FileText,
  layers: Layers,
  grid: PanelsTopLeft,
};
const nav = [
  ["overview", "总览"],
  ["skills", "四个 Skill"],
  ["files", "文件结构"],
  ["runtime", "运行与交付"],
  ["standards", "制作规范"],
];
function Icon({ name, ...props }) {
  const C = icons[name] || FileText;
  return <C aria-hidden="true" size={22} strokeWidth={1.7} {...props} />;
}
function SectionTitle({ number, title, desc }) {
  return (
    <div className="section-head">
      <div>
        <div className="section-number">{number} / EXPLORE</div>
        <h2>{title}</h2>
        {desc && <p className="section-desc">{desc}</p>}
      </div>
    </div>
  );
}
function ReadableSource({ text }) {
  const lines = text.split("\n");
  const blocks = [];
  let code = [],
    inCode = false,
    front = [];
  let frontmatter = lines[0] === "---";
  lines.forEach((line, i) => {
    if (frontmatter) {
      if (i > 0 && line === "---") {
        frontmatter = false;
        blocks.push(
          <div key={"m" + i} className="doc-meta">
            {front.filter((x) => /^(name|description):/.test(x)).join(" · ")}
          </div>,
        );
      } else front.push(line);
      return;
    }
    if (line.startsWith("```")) {
      if (inCode) {
        blocks.push(
          <pre key={i} className="doc-code">
            {code.join("\n")}
          </pre>,
        );
        code = [];
      }
      inCode = !inCode;
      return;
    }
    if (inCode) {
      code.push(line);
      return;
    }
    if (/^#{1,3} /.test(line)) {
      const level = line.match(/^#+/)[0].length;
      blocks.push(
        <h3 key={i} className={"doc-h " + (level === 3 ? "doc-h3" : "")}>
          {line.replace(/^#+ /, "")}
        </h3>,
      );
    } else if (/^[-*] /.test(line)) {
      blocks.push(
        <div className="doc-list" key={i}>
          {line}
        </div>,
      );
    } else if (line.trim()) {
      blocks.push(
        <p className="doc-paragraph" key={i}>
          {line}
        </p>,
      );
    }
  });
  return blocks;
}
export function FileExplorer({ files, selected, onSelect, onRead }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState(false);
  const matches = files.filter((f) =>
    (f.path + " " + f.title + " " + f.summary)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const groups = [
    ["插件配置与资源", matches.filter((f) => !f.path.startsWith("skills/"))],
    ...[
      "use-showai",
      "show-document",
      "create-component",
      "create-template",
    ].map((id) => [
      id,
      matches.filter((f) => f.path.startsWith("skills/" + id + "/")),
    ]),
  ];
  const file = files.find((f) => f.path === selected) || files[0];
  return (
    <div className="explorer">
      <div className="file-list">
        <label className="search-box">
          <Search aria-hidden="true" size={16} />
          <input
            aria-label="搜索插件文件"
            placeholder="搜索文件或内容主题…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              aria-label="清空搜索"
              onClick={() => setQuery("")}
              style={{
                border: 0,
                background: "transparent",
                display: "flex",
                padding: 2,
              }}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <div className="tree-root">
          <Folder size={15} />
          plugins/showai/
        </div>
        {matches.length === 0 ? (
          <p className="empty" role="status">
            没有找到匹配文件。试试“模板”“读取”或“菜单”。
          </p>
        ) : (
          groups.map(
            ([label, items]) =>
              items.length > 0 && (
                <div key={label}>
                  <div className="tree-folder">
                    <ChevronRight size={13} />
                    {label}
                  </div>
                  {items.map((f) => (
                    <button
                      key={f.path}
                      className={
                        "file-button " + (f.path === file.path ? "active" : "")
                      }
                      aria-pressed={f.path === file.path}
                      onClick={() => {
                        onSelect(f.path);
                        setSource(false);
                      }}
                    >
                      {f.path.endsWith(".json") ? <FileJson /> : <FileText />}
                      <span>
                        {f.path.startsWith("skills/")
                          ? f.path.split("/").slice(2).join("/")
                          : f.path}
                      </span>
                    </button>
                  ))}
                </div>
              ),
          )
        )}
      </div>
      <div className="file-content" aria-live="polite">
        <div className="file-path">plugins/showai/{file.path}</div>
        <span className="badge">{file.kind}</span>
        <h3>{file.title}</h3>
        <p>{file.summary}</p>
        <div className="file-meta">
          <span>{file.lines} 行</span>
          <span>SHA-256 · {file.hash.slice(0, 10)}</span>
        </div>
        {file.path === ".claude-plugin/plugin.json" && (
          <p className="source-status">
            源文件版本字段为 0.7.2；主清单版本为 0.9.0。这里保留实际差异。
          </p>
        )}
        <div className="file-headings">
          <div className="kicker">
            <BookOpen size={15} />
            文件里有哪些内容
          </div>
          {file.headings.map((h, i) => (
            <div key={i} className="file-heading-item">
              {h}
            </div>
          ))}
        </div>
        <div className="file-actions">
          <button className="primary" onClick={() => onRead(file)}>
            <BookOpen size={15} />
            阅读完整原文
          </button>
          <button
            className="copy-button"
            aria-expanded={source}
            onClick={() => setSource(!source)}
          >
            <Code size={14} />
            {source ? "收起源码" : "查看原始源码"}
          </button>
        </div>
        {source && <pre className="source-code">{file.content}</pre>}
        <p className="small-note">
          此处为构建时保存的文件快照，可离线阅读。文案摘要与原文分开呈现。
        </p>
      </div>
    </div>
  );
}
export function SkillMap({
  skills,
  selected,
  onSelect,
  scenario,
  onScenario,
  scenarios,
}) {
  const current = skills.find((x) => x.id === selected) || skills[0];
  return (
    <div className="map">
      <h2>一个请求，怎样变成页面？</h2>
      <p className="section-desc">
        按任务选择 Skill；需要时协作，再由运行时执行具体操作。
      </p>
      <div className="task-select">
        <div className="row-label">你的任务</div>
        <label className="select-wrap">
          <UserRound size={19} aria-hidden="true" />
          <select
            aria-label="选择任务场景"
            value={scenario}
            onChange={(e) => onScenario(e.target.value)}
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.request}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="map-nodes">
        {skills.map((s) => (
          <button
            key={s.id}
            className={"map-node " + (s.id === selected ? "active" : "")}
            aria-pressed={s.id === selected}
            onClick={() => onSelect(s.id)}
          >
            <Icon name={s.icon} className="node-icon" />
            <div>
              <strong>{s.id}</strong>
              <span className="node-label">{s.label}</span>
              <span className="node-desc">{s.tagline}</span>
            </div>
          </button>
        ))}
      </div>
      <div className="route-note">
        <Info size={14} />
        <span>本场景：</span>
        {scenarios
          .find((s) => s.id === scenario)
          .route.map((id, i) => (
            <React.Fragment key={id + i}>
              {i > 0 && <ArrowRight size={12} />}
              <span>{id}</span>
            </React.Fragment>
          ))}
      </div>
      <div className="runtime-strip">
        <div className="runtime-item">
          <Terminal size={27} />
          <div>
            <b>CLI / MCP</b>
            <small>Agent 调用实际能力</small>
          </div>
        </div>
        <ArrowRight className="arrow" size={18} />
        <div className="runtime-item">
          <Settings2 size={28} />
          <div>
            <b>ShowAI 运行时</b>
            <small>读取、编译、保存与导出</small>
          </div>
        </div>
        <ArrowRight className="arrow" size={18} />
        <div className="runtime-item">
          <PanelsTopLeft size={27} />
          <div>
            <b>页面 / HTML / 项目</b>
            <small>按归属和显示能力交付</small>
          </div>
        </div>
      </div>
      <div className="selected-summary" aria-live="polite">
        <div>
          <div className="summary-name">
            <Icon name={current.icon} size={19} />
            <strong>当前选择 · {current.id}</strong>
          </div>
          <p className="summary-copy">{current.summary}</p>
        </div>
        <div className="summary-right">
          <div className="kicker">会得到什么</div>
          {current.result}
          <br />
          <a href="#skills">
            查看职责与参考文档 <ArrowRight size={13} />
          </a>
        </div>
      </div>
    </div>
  );
}
export function TaskJourney({ scenarios, scenario, onScenario, onSkill }) {
  const current = scenarios.find((s) => s.id === scenario) || scenarios[0];
  return (
    <div>
      <div className="scenario-buttons" aria-label="任务路线">
        {scenarios.map((s) => (
          <button
            key={s.id}
            className={s.id === scenario ? "active" : ""}
            aria-pressed={s.id === scenario}
            onClick={() => onScenario(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="journey" aria-live="polite">
        <p className="journey-request">{current.request}</p>
        <div className="route">
          {current.route.map((id, i) => (
            <React.Fragment key={id + i}>
              {i > 0 && <ArrowRight size={15} aria-hidden="true" />}
              <button
                onClick={() => {
                  onSkill(id);
                }}
              >
                {id}
              </button>
            </React.Fragment>
          ))}
        </div>
        <div className="journey-steps">
          {current.steps.map(([title, body], i) => (
            <div className="step" key={title}>
              <strong>
                <span>0{i + 1}</span>
                {title}
              </strong>
              <p>{body}</p>
            </div>
          ))}
        </div>
        <div className="result-line">
          <Check size={17} />
          {current.result}
        </div>
      </div>
    </div>
  );
}
export function DeliveryChooser() {
  const [inline, setInline] = useState(true),
    [project, setProject] = useState(false);
  return (
    <div className="delivery">
      <div>
        <h3>展示方式与内容归属，分别选择</h3>
        <p>
          有无对话预览，和是否保存到项目，是两个独立维度。公共资源与独立渲染无需个人项目登录。
        </p>
        <div className="toggles">
          <label>
            <input
              type="checkbox"
              checked={inline}
              onChange={(e) => setInline(e.target.checked)}
            />
            宿主支持对话预览
          </label>
          <label>
            <input
              type="checkbox"
              checked={project}
              onChange={(e) => setProject(e.target.checked)}
            />
            保存到已授权项目
          </label>
        </div>
      </div>
      <div className="delivery-result" aria-live="polite">
        <strong>
          {project ? "项目页面" : "独立展示"}
          {inline ? " + 对话预览" : " + 文件或保存回执"}
        </strong>
        <p>
          {project
            ? "使用真实项目与页面身份，核对保存结果；绑定同步项目时再检查同步状态。"
            : "使用公共资源或自定义源码独立渲染，交付 HTML 与可编辑源文件。"}
          {inline
            ? " 通过宿主实际支持的 inline / MCP Apps 呈现。"
            : " 宿主没有 HTML 显示能力时，仍可完成文件或项目交付。"}
        </p>
        <p>
          {project
            ? "本地保存成功与远程同步成功，需要分别核对。"
            : "独立渲染不代表已保存到个人项目，也不代表已同步。"}
        </p>
      </div>
    </div>
  );
}
export default function PluginAtlas({ data }) {
  const [selected, setSelected] = useState("show-document"),
    [filePath, setFilePath] = useState("skills/show-document/SKILL.md"),
    [scenario, setScenario] = useState("page"),
    [active, setActive] = useState("overview"),
    [opened, setOpened] = useState(null),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState(false);
  const dialog = useRef(null),
    root = useRef(null);
  const uid = useId().replace(/:/g, "");
  const skills = data.skills,
    skill = skills.find((s) => s.id === selected) || skills[0];
  useEffect(() => {
    if (!root.current) return;
    const targets = root.current.querySelectorAll("main>section");
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-70px 0px -60% 0px", threshold: 0 },
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (opened && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [opened]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2200);
    return () => clearTimeout(timer);
  }, [copied]);
  function selectScenario(id) {
    setScenario(id);
    const s = data.scenarios.find((x) => x.id === id);
    if (s)
      setSelected(
        s.route.includes("show-document") ? "show-document" : s.route[0],
      );
  }
  function goTo(id) {
    root.current
      ?.querySelector("#" + id)
      ?.scrollIntoView({ behavior: "smooth" });
    setActive(id);
  }
  function selectFile(path) {
    setFilePath(path);
    goTo("files");
  }
  async function copyPrompt() {
    setCopyError(false);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(skill.example);
      setCopied(true);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <div
      className="atlas"
      ref={root}
      onClick={(event) => {
        const link = event.target.closest?.('a[href^="#"]');
        if (link && root.current?.contains(link)) {
          event.preventDefault();
          goTo(link.getAttribute("href").slice(1));
        }
      }}
    >
      <style>{css}</style>
      <header className="topbar">
        <a className="brand brand-link" href="#overview">
          <img src={data.logo} alt="" />
          ShowAI<span>插件指南</span>
        </a>
        <div className="top-actions">
          <span>v{data.version}</span>
          <a
            className="source"
            href={data.repository}
            target="_blank"
            rel="noreferrer"
          >
            查看源码 <SquareArrowOutUpRight size={12} />
          </a>
        </div>
      </header>
      <nav className="mobile-nav" aria-label="章节导航">
        {nav.map(([id, label]) => (
          <a href={"#" + id} key={id}>
            {label}
          </a>
        ))}
      </nav>
      <div className="shell">
        <aside className="sidebar">
          <nav aria-label="文档目录">
            {nav.map(([id, label], i) => (
              <a
                key={id}
                href={"#" + id}
                className={"nav-link " + (active === id ? "active" : "")}
                aria-current={active === id ? "location" : undefined}
              >
                <span>0{i + 1}</span>
                {label}
              </a>
            ))}
          </nav>
          <div className="sidebar-foot">
            <strong>基于插件源码</strong>
            {data.date} · {data.sourceCommit.slice(0, 7)}
            <br />
            可交互 · 可离线阅读
          </div>
        </aside>
        <main className="content">
          <section id="overview">
            <p className="eyebrow">SHOWAI / PLUGIN ATLAS</p>
            <div className="intro-top">
              <h1>{data.title}</h1>
              <span className="meta">
                {skills.length} 个 Skill ·{" "}
                {data.files.filter((f) => f.kind === "参考").length} 份参考文档
              </span>
            </div>
            <p className="lead">从一个请求，到可阅读、可交互的页面。</p>
            <p className="intro-copy">
              ShowAI
              插件把内容查找、页面创作、组件开发和模板制作组织成四条工作流。Skill
              说明如何决策，参考文档补充细节，CLI 或 MCP 连接实际的 ShowAI
              运行时。沿着下面的结构，可以逐层看清每部分负责什么。
            </p>
            <SkillMap
              skills={skills}
              selected={selected}
              onSelect={setSelected}
              scenario={scenario}
              onScenario={selectScenario}
              scenarios={data.scenarios}
            />
          </section>
          <section id="skills" className="block-section">
            <SectionTitle
              number="02"
              title="四个 Skill，各自负责什么"
              desc="选择一个入口，查看适用场景、完成边界与它实际包含的文档。"
            />
            <div className="skill-buttons" aria-label="选择 Skill">
              {skills.map((s) => (
                <button
                  key={s.id}
                  className={
                    "skill-button " + (selected === s.id ? "active" : "")
                  }
                  aria-pressed={selected === s.id}
                  onClick={() => setSelected(s.id)}
                >
                  {s.id}
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
            <div className="skill-detail" aria-live="polite">
              <div>
                <h3>
                  <Icon name={skill.icon} />
                  {skill.id}
                </h3>
                <p>{skill.summary}</p>
                <div className="small-label">什么时候使用</div>
                <ul>
                  {skill.when.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="kicker">
                  <Workflow size={15} />
                  主要工作
                </div>
                <ul>
                  {skill.does.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <div className="small-label">交付结果</div>
                <p>{skill.result}</p>
              </div>
              <div>
                <div className="kicker">
                  <Folder size={15} />
                  入口与参考文件
                </div>
                <button
                  className="reference-button"
                  onClick={() => selectFile("skills/" + skill.id + "/SKILL.md")}
                >
                  <FileText size={14} />
                  SKILL.md
                </button>
                {skill.refs.map((name) => (
                  <button
                    key={name}
                    className="reference-button"
                    onClick={() =>
                      selectFile("skills/" + skill.id + "/references/" + name)
                    }
                  >
                    <FileText size={14} />
                    {name}
                  </button>
                ))}
                <div className="small-label">按需查询的运行时指南</div>
                <p
                  style={{ fontSize: 12, fontFamily: "ui-monospace,monospace" }}
                >
                  {skill.guides.join(" · ")}
                </p>
              </div>
            </div>
            <div className="boundary">
              <Info size={17} />
              <span>{skill.boundary}</span>
            </div>
            <div className="example">
              <span>可以这样提出任务：“{skill.example}”</span>
              <button
                className="copy-button"
                onClick={copyPrompt}
                aria-label={
                  copyError ? "请选中示例复制" : copied ? "已复制" : "复制示例"
                }
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span role="status">
                  {copyError
                    ? "请选中左侧示例复制"
                    : copied
                      ? "已复制"
                      : "复制示例"}
                </span>
              </button>
            </div>
          </section>
          <section id="files" className="block-section">
            <SectionTitle
              number="03"
              title="打开插件，里面有什么"
              desc="左侧是实际文件结构；点击文件，查看用途、目录和完整原文。"
            />
            <FileExplorer
              files={data.files}
              selected={filePath}
              onSelect={setFilePath}
              onRead={setOpened}
            />
            <p className="small-note">
              文件来源：plugins/showai/ · 快照日期 {data.date} ·
              内容指纹随构建保存。运行时、组件目录和用户内容库位于插件包之外。
            </p>
            <div className="concept-grid">
              {data.concepts.map(([name, en, desc]) => (
                <div className="concept" key={en}>
                  <strong>{name}</strong>
                  <code>{en}</code>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </section>
          <section id="runtime" className="block-section">
            <SectionTitle
              number="04"
              title="从工作流，到实际运行"
              desc="先看三层之间的关系，再选择一个场景，跟随任务走一遍。"
            />
            <div className="runtime-layers">
              <div className="layer">
                <h3>工作流层</h3>
                <p>Skill 决定何时做什么，参考文档说明特定任务的操作与约束。</p>
                <div className="layer-items">
                  SKILL.md + references/
                  <br />
                  随插件分发
                </div>
              </div>
              <div className="layer">
                <h3>操作接口层</h3>
                <p>
                  CLI 在本地调用；MCP
                  使用已连接的服务。软件指南返回当前操作协议。
                </p>
                <div className="layer-items">
                  runtime info / showai_capabilities
                  <br />
                  guide · catalog · pages · render
                </div>
              </div>
              <div className="layer">
                <h3>运行与内容层</h3>
                <p>
                  ShowAI
                  软件实际读取、编译、保存和导出；内容归属由项目与内容库决定。
                </p>
                <div className="layer-items">
                  运行时 / 组件与模板目录
                  <br />
                  内容库 / 本地或共享项目
                </div>
              </div>
            </div>
            <TaskJourney
              scenarios={data.scenarios}
              scenario={scenario}
              onScenario={selectScenario}
              onSkill={(id) => {
                setSelected(id);
                goTo("skills");
              }}
            />
            <DeliveryChooser />
          </section>
          <section id="standards" className="block-section">
            <SectionTitle
              number="05"
              title="制作规范，现在放在哪里"
              desc="已有规则与整理建议分别标注；建议中的文件尚未加入插件。"
            />
            <div className="standard-grid">
              {data.standards.map((s) => (
                <article className="standard" key={s.title}>
                  <div className="standard-top">
                    <h3>{s.title}</h3>
                    <span
                      className={
                        "badge " + (s.status === "待整理建议" ? "warn" : "")
                      }
                    >
                      {s.status}
                    </span>
                  </div>
                  <p className="owner">{s.owner}</p>
                  <p>{s.current}</p>
                  <details>
                    <summary>查看缺口与整理建议</summary>
                    <p>
                      {s.gap}
                      <br />
                      {s.proposal}
                    </p>
                  </details>
                </article>
              ))}
            </div>
            <div className="scope-note">
              ShowAI
              工作台本身的侧栏、窗口和设置界面属于应用开发范围，当前还有本机开发规则约束。这些本机规则不随插件分发；此处只说明边界，不包含本机规则原文。
            </div>
          </section>
          <footer>
            <span>ShowAI 插件导览 · 基于真实文件的可交互文档</span>
            <span>
              {data.files.length} 份文件快照 · {data.date} · v{data.version}
            </span>
          </footer>
        </main>
      </div>
      <dialog
        ref={dialog}
        className="doc-dialog"
        aria-labelledby={"doc-title-" + uid}
        onClose={() => setOpened(null)}
      >
        {opened && (
          <>
            <div className="dialog-header">
              <div className="dialog-title" id={"doc-title-" + uid}>
                {opened.path}
              </div>
              <button
                aria-label="关闭原文"
                onClick={() => dialog.current.close()}
              >
                <X size={19} />
              </button>
            </div>
            <div className="dialog-body">
              {opened.path.endsWith(".md") ? (
                <ReadableSource text={opened.content} />
              ) : (
                <pre className="doc-code">{opened.content}</pre>
              )}
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}

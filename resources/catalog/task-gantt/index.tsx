import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
  type CSSProperties,
} from "react";
import {
  conflicts,
  columnLabels,
  defaultColumns,
  descendants,
  date,
  day,
  removeTask,
  shiftBranch,
  summarize,
  outline,
  status,
  today,
  taskColors,
  validate,
  type GanttData,
  type Task,
  type Column,
  type TaskColor,
} from "./model";
import "./style.css";

export default function TaskGantt({
  data,
  onChange,
  readOnly = true,
}: {
  data: GanttData;
  onChange?: (next: GanttData) => void;
  readOnly: boolean;
}) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部状态");
  const [scale, setScale] = useState<"fit" | "day" | "week">("fit");
  const [anchor, setAnchor] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Task | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showColumns, setShowColumns] = useState(false);
  const [localColumns, setLocalColumns] = useState<Column[] | null>(null);
  const [drag, setDrag] = useState<{
    task: Task;
    delta: number;
    mode: "move" | "start" | "end";
  } | null>(null);
  const dragRef = useRef<{
    task: Task;
    x: number;
    width: number;
    span: number;
    delta: number;
    mode: "move" | "start" | "end";
  } | null>(null);
  useEffect(() => {
    setDraft(null);
    setError(null);
    setDrag(null);
    dragRef.current = null;
  }, [data]);
  const invalid = validate(data);
  if (invalid)
    return (
      <section className="sg-gantt">
        <p role="alert">{invalid}</p>
      </section>
    );
  const current = today();
  const raw = data.tasks;
  const all = summarize(raw);
  const searching = !!query.trim() || filter !== "全部状态";
  const matches = (task: Task) =>
    `${task.title} ${task.owner ?? ""} ${task.phase ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()) &&
    (filter === "全部状态" || status(task, current) === filter);
  const rows = outline(all, collapsed, searching ? matches : undefined);
  const displayed = new Map(
    (drag
      ? summarize(shiftBranch(raw, drag.task.id, drag.delta, drag.mode))
      : all
    ).map((task) => [task.id, task]),
  );
  const columns = localColumns ?? data.columns ?? defaultColumns;
  const weights: Record<Column, string> = {
    title: "minmax(0, 2.8fr)",
    owner: "minmax(0, .8fr)",
    status: "minmax(0, .9fr)",
    phase: "minmax(0, .8fr)",
    progress: "minmax(0, .9fr)",
    start: "minmax(0, 1fr)",
    end: "minmax(0, 1fr)",
  };
  const gridStyle = {
    "--sg-columns": columns.map((column) => weights[column]).join(" "),
    "--sg-list-width":
      columns.length === 1
        ? "36%"
        : `${Math.min(64, 38 + (columns.length - 1) * 7)}%`,
  } as CSSProperties;
  const leafTasks = all.filter(
    (task) => !raw.some((child) => child.parentId === task.id),
  );
  function setColumns(next: Column[]) {
    setLocalColumns(next);
    if (!readOnly && onChange)
      commit({ ...data, columns: next }, "显示列已更新");
  }
  const min = all.length
    ? Math.min(...all.map((task) => day(task.start))) - 1
    : day(current) - 2;
  const max = all.length
    ? Math.max(...all.map((task) => day(task.end))) + 2
    : min + 20;
  const span =
    scale === "fit" ? Math.max(7, max - min + 1) : scale === "day" ? 21 : 56;
  const origin = scale === "fit" ? min : (anchor ?? min);
  const ticks = Array.from({ length: 7 }, (_, i) => Math.floor((i * span) / 7));
  const pick = all.find((task) => task.id === selected);
  const completed = leafTasks.filter((task) => task.progress === 100).length;
  const late = leafTasks.filter(
    (task) => status(task, current) === "已逾期",
  ).length;
  const mean = leafTasks.length
    ? Math.round(
        leafTasks.reduce((total, task) => total + task.progress, 0) /
          leafTasks.length,
      )
    : 0;
  function commit(next: GanttData, text: string) {
    const issue = validate(next);
    if (issue) {
      setError(issue);
      return false;
    }
    if (readOnly || !onChange) return false;
    onChange(next);
    setMessage(text);
    setError(null);
    return true;
  }
  function begin(task?: Task, parentId?: string) {
    setError(null);
    setIsNew(!task);
    setDraft(
      task
        ? {
            ...task,
            dependencies: [...(task.dependencies ?? [])],
          }
        : {
            id: `task-${crypto.randomUUID()}`,
            title: "",
            start: current,
            end: date(day(current) + 3),
            progress: 0,
            owner: "",
            phase: "",
            dependencies: [],
            ...(parentId ? { parentId } : {}),
          },
    );
  }
  function pointerDown(
    event: PointerEvent<HTMLButtonElement>,
    task: Task,
    mode: "move" | "start" | "end",
  ) {
    if (readOnly || !onChange || event.button !== 0) return;
    const lane = event.currentTarget.closest(".sg-lane");
    if (!lane) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      task,
      mode,
      x: event.clientX,
      width: lane.getBoundingClientRect().width,
      span,
      delta: 0,
    };
    setSelected(task.id);
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const active = dragRef.current;
    if (!active) return;
    const delta = Math.round(
      ((event.clientX - active.x) / active.width) * active.span,
    );
    active.delta = delta;
    setDrag({ task: active.task, mode: active.mode, delta });
  }
  function pointerUp() {
    const active = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!active || !active.delta) return;
    const nextTasks = shiftBranch(
      raw,
      active.task.id,
      active.delta,
      active.mode,
    );
    const next = summarize(nextTasks).find(
      (task) => task.id === active.task.id,
    )!;
    commit(
      {
        ...data,
        tasks: nextTasks,
      },
      `已调整「${next.title}」：${next.start} 至 ${next.end}`,
    );
  }
  const pointerHandlers = {
    onPointerMove: pointerMove,
    onPointerUp: pointerUp,
    onPointerCancel: () => {
      dragRef.current = null;
      setDrag(null);
    },
  };
  return (
    <section className="sg-gantt" aria-label={data.title}>
      <header className="sg-heading">
        <div>
          {data.title && !["任务甘特图", "项目排期", "甘特图"].includes(data.title.trim()) && <h2>{data.title}</h2>}
          {data.description && <p>{data.description}</p>}
        </div>
      </header>
      <div className="sg-summary">
        <span>
          <strong>{leafTasks.length}</strong> 个任务
        </span>
        <span>
          <strong>{completed}</strong> 已完成
        </span>
        <span>
          <strong>{mean}%</strong> 平均进度
        </span>
        {late > 0 && (
          <span className="sg-danger">
            <strong>{late}</strong> 已逾期
          </span>
        )}
        <div
          className="sg-overall"
          role="progressbar"
          aria-label="平均任务进度"
          aria-valuenow={mean}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: `${mean}%` }} />
        </div>

      </div>
      {showColumns && (
        <div className="sg-column-settings" aria-label="显示列设置">
          {(Object.keys(columnLabels) as Column[]).map((column) => (
            <label className="sg-check" key={column}>
              <input
                type="checkbox"
                checked={columns.includes(column)}
                disabled={column === "title"}
                onChange={(event) =>
                  setColumns(
                    event.target.checked
                      ? [...columns, column]
                      : columns.filter((item) => item !== column),
                  )
                }
              />
              {columnLabels[column]}
            </label>
          ))}
          <div className="sg-column-order">
            {columns.map((column, index) => (
              <span key={column}>
                {columnLabels[column]}
                {index > 1 && (
                  <button
                    type="button"
                    aria-label={`前移${columnLabels[column]}列`}
                    onClick={() => {
                      const next = [...columns];
                      [next[index - 1], next[index]] = [
                        next[index],
                        next[index - 1],
                      ];
                      setColumns(next);
                    }}
                  >
                    ←
                  </button>
                )}
                {index > 0 && index < columns.length - 1 && (
                  <button
                    type="button"
                    aria-label={`后移${columnLabels[column]}列`}
                    onClick={() => {
                      const next = [...columns];
                      [next[index + 1], next[index]] = [
                        next[index],
                        next[index + 1],
                      ];
                      setColumns(next);
                    }}
                  >
                    →
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
      <details className="sg-tools-menu">
        <summary aria-label="甘特图视图与筛选">视图与筛选</summary>
      <div className="sg-toolbar">
        <button
          type="button"
          aria-expanded={showColumns}
          onClick={() => setShowColumns(!showColumns)}
        >
          显示列
        </button>
        <label className="sg-search">
          <span className="sg-sr">搜索任务、负责人或阶段</span>
          <input
            placeholder="搜索任务、负责人、阶段"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="筛选任务状态"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          {["全部状态", "未开始", "进行中", "已完成", "已逾期"].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <div className="sg-scales" aria-label="时间尺度">
          {(
            [
              ["fit", "全览"],
              ["day", "按日"],
              ["week", "按周"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={scale === value}
              onClick={() => {
                setScale(value);
                setAnchor(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {!readOnly && onChange && (
          <button
            type="button"
            className="sg-primary"
            disabled={all.length >= 200}
            onClick={() => begin()}
          >
            ＋ 新建任务
          </button>
        )}
      </div>
      </details>
      <div className="sg-range">
        <span>
          {date(origin)} — {date(origin + span - 1)}
        </span>
        {scale !== "fit" && (
          <div>
            <button
              type="button"
              aria-label="前一个时间段"
              onClick={() => setAnchor(origin - span)}
            >
              ←
            </button>
            <button type="button" onClick={() => setAnchor(day(current) - 3)}>
              今天
            </button>
            <button
              type="button"
              aria-label="后一个时间段"
              onClick={() => setAnchor(origin + span)}
            >
              →
            </button>
          </div>
        )}
        <span>
          {rows.length} 行
        </span>
      </div>
      <div className="sg-grid" style={gridStyle}>
        <div className="sg-axis">
          <div className="sg-list-head">
            {columns.map((column) => (
              <span key={column} className={`sg-col-${column}`}>
                {columnLabels[column]}
              </span>
            ))}
          </div>
          <div>
            {ticks.map((offset, i) => (
              <span
                key={offset}
                className={`sg-tick sg-tick-${i}`}
                style={{ left: `${(offset / span) * 100}%` }}
              >
                {date(origin + offset)
                  .slice(5)
                  .replace("-", "/")}
              </span>
            ))}
          </div>
        </div>
        {rows.map(({ task: original, depth, childCount, matched }) => {
          const task = displayed.get(original.id)!;
          const start = day(task.start),
            end = day(task.end),
            right = origin + span;
          const visible = end >= origin && start < right;
          const left = Math.max(0, ((start - origin) / span) * 100);
          const width = Math.max(
            0,
            ((Math.min(end + 1, right) - Math.max(start, origin)) / span) * 100,
          );
          const state = status(task, current),
            issues = conflicts(task, all);
          return (
            <div
              className={`sg-row sg-color-${task.color ?? "blue"} ${selected === task.id ? "sg-selected" : ""}`}
              key={task.id}
            >
              <div
                className={`sg-list-row ${childCount ? "sg-parent" : ""} ${matched ? "" : "sg-context-row"}`}
              >
                {columns.map((column) =>
                  column === "title" ? (
                    <div
                      className="sg-title-cell sg-col-title"
                      key={column}
                      style={{ paddingLeft: Math.min(depth, 6) * 12 }}
                    >
                      {childCount > 0 ? (
                        <button
                          type="button"
                          className="sg-expander"
                          aria-label={`${collapsed.has(task.id) && !searching ? "展开" : "收起"}${task.title}`}
                          aria-expanded={searching || !collapsed.has(task.id)}
                          disabled={searching}
                          onClick={() =>
                            setCollapsed((previous) => {
                              const next = new Set(previous);
                              if (next.has(task.id)) next.delete(task.id);
                              else next.add(task.id);
                              return next;
                            })
                          }
                        >
                          {collapsed.has(task.id) && !searching ? "▸" : "▾"}
                        </button>
                      ) : (
                        <span className="sg-branch-dot">
                          <i
                            className={`sg-dot ${task.progress === 100 ? "sg-done" : state === "已逾期" ? "sg-late" : ""}`}
                          />
                        </span>
                      )}
                      <button
                        type="button"
                        className="sg-task"
                        data-tooltip={task.title}
                        aria-label={`查看任务 ${task.title}，第 ${depth + 1} 层，${state}`}
                        aria-pressed={selected === task.id}
                        onClick={() => {
                          setSelected(task.id);
                          setDraft(null);
                        }}
                      >
                        <span>{task.title}</span>
                      </button>
                      {issues.length > 0 && (
                        <span
                          className="sg-conflict"
                          aria-label="依赖冲突"
                          data-tooltip="依赖任务尚未结束"
                        >
                          !
                        </span>
                      )}
                      {childCount > 0 && (
                        <span className="sg-child-count">{childCount}</span>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      key={column}
                      className={`sg-value-cell sg-col-${column}`}
                      onClick={() => {
                        setSelected(task.id);
                        setDraft(null);
                      }}
                      aria-label={`${task.title} · ${columnLabels[column]}：${column === "status" ? state : column === "progress" ? `${task.progress}%` : task[column] || "未分配"}`}
                    >
                      {column === "status"
                        ? state
                        : column === "progress"
                          ? `${task.progress}%`
                          : column === "start" || column === "end"
                            ? task[column].slice(5).replace("-", "/")
                            : task[column] || "—"}
                    </button>
                  ),
                )}
              </div>
              <div
                className="sg-lane"
                aria-label={`${task.title}：${task.start} 至 ${task.end}，进度 ${task.progress}%`}
              >
                {Array.from({ length: Math.min(span, 70) }, (_, i) => (
                  <i
                    className={`sg-cell ${span <= 70 && [0, 6].includes(new Date((origin + i) * 86400000).getUTCDay()) ? "sg-weekend" : ""}`}
                    key={i}
                    style={{
                      left: `${(i / Math.min(span, 70)) * 100}%`,
                      width: `${100 / Math.min(span, 70)}%`,
                    }}
                  />
                ))}
                {day(current) >= origin && day(current) < right && (
                  <i
                    className="sg-today"
                    style={{
                      left: `${((day(current) - origin + 0.5) / span) * 100}%`,
                    }}
                  ></i>
                )}
                {visible ? (
                  <div
                    className={`sg-bar-wrap ${task.milestone ? "sg-is-milestone" : ""}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    <button
                      type="button"
                      className={`sg-bar ${childCount ? "sg-summary-bar" : ""} ${task.progress === 100 ? "sg-done" : state === "已逾期" ? "sg-late" : ""}`}
                      onClick={() => setSelected(task.id)}
                      onPointerDown={(event) =>
                        pointerDown(event, task, "move")
                      }
                      {...pointerHandlers}
                      aria-label={`查看 ${task.title}，${task.start} 至 ${task.end}，${task.progress}%`}
                      style={{ touchAction: readOnly ? "auto" : "none" }}
                    >
                      {task.milestone ? (
                        <span className="sg-diamond" />
                      ) : (
                        <>
                          <i
                            className="sg-progress"
                            style={{ width: `${task.progress}%` }}
                          />
                          <span className="sg-bar-label">
                            {width > 13 ? `${task.progress}%` : ""}
                          </span>
                        </>
                      )}
                    </button>
                    {!readOnly &&
                      onChange &&
                      !task.milestone &&
                      !childCount &&
                      width > 3 && (
                        <>
                          <button
                            type="button"
                            className="sg-handle sg-handle-start"
                            aria-label={`调整 ${task.title} 开始日期`}
                            onPointerDown={(event) =>
                              pointerDown(event, task, "start")
                            }
                            {...pointerHandlers}
                          />
                          <button
                            type="button"
                            className="sg-handle sg-handle-end"
                            aria-label={`调整 ${task.title} 结束日期`}
                            onPointerDown={(event) =>
                              pointerDown(event, task, "end")
                            }
                            {...pointerHandlers}
                          />
                        </>
                      )}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="sg-outside"
                    onClick={() => {
                      setScale("day");
                      setAnchor(start - 2);
                      setSelected(task.id);
                    }}
                  >
                    查看排期 {start >= right ? "→" : "←"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!rows.length && (
          <div className="sg-empty">
            {all.length
              ? "没有符合条件的任务。"
              : "还没有任务，创建第一个任务开始排期。"}
          </div>
        )}
      </div>
      <footer className="sg-legend">
        <span>条形深色部分表示进度</span>
        <span>◆ 里程碑</span>
        <span>浅色列为周末 · 竖线为今天</span>
      </footer>
      {pick && !draft && (
        <div className="sg-detail">
          <div className="sg-detail-top">
            <h3>{pick.title}</h3>
            <button
              type="button"
              aria-label="关闭任务详情"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
          </div>
          <div className="sg-detail-values">
            <span>
              {pick.start} — {pick.end}
            </span>
            <span>{pick.owner || "未分配"}</span>
            <span>
              {pick.progress}% · {status(pick, current)}
            </span>
          </div>
          {raw.some((child) => child.parentId === pick.id) && (
            <p>
              汇总任务 · 日期与进度由子任务自动计算，拖动可整体调整子任务排期。
            </p>
          )}
          {(pick.dependencies ?? []).length > 0 && (
            <p>
              前置任务：
              {all
                .filter((task) => pick.dependencies!.includes(task.id))
                .map((task) => task.title)
                .join("、")}
            </p>
          )}
          {conflicts(pick, all).length > 0 && (
            <p className="sg-danger">
              依赖冲突：前置任务结束后，才能开始当前任务。
            </p>
          )}
          {!readOnly && onChange && (
            <div className="sg-detail-actions">
              <button type="button" onClick={() => begin(pick)}>
                编辑任务
              </button>
              {!raw.some((child) => child.parentId === pick.id) && (
                <button
                  type="button"
                  onClick={() =>
                    commit(
                      {
                        ...data,
                        tasks: raw.map((task) =>
                          task.id === pick.id
                            ? {
                                ...task,
                                progress: task.progress === 100 ? 0 : 100,
                              }
                            : task,
                        ),
                      },
                      "任务进度已更新",
                    )
                  }
                >
                  {pick.progress === 100 ? "重新打开" : "标记完成"}
                </button>
              )}
              {!pick.milestone && (
                <button
                  type="button"
                  disabled={raw.length >= 200}
                  onClick={() => {
                    setCollapsed((previous) => {
                      const next = new Set(previous);
                      next.delete(pick.id);
                      return next;
                    });
                    begin(undefined, pick.id);
                  }}
                >
                  ＋ 添加子任务
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {draft && (
        <form
          className="sg-editor"
          onSubmit={(event) => {
            event.preventDefault();
            const task = {
              ...draft,
              title: draft.title.trim(),
              end: draft.milestone ? draft.start : draft.end,
            };
            if (
              commit(
                {
                  ...data,
                  tasks: isNew
                    ? [...raw, task]
                    : raw.map((item) => (item.id === task.id ? task : item)),
                },
                isNew ? "任务已创建" : "任务已保存",
              )
            ) {
              setDraft(null);
              setSelected(task.id);
            }
          }}
        >
          <div className="sg-detail-top">
            <h3>{isNew ? "新建任务" : "编辑任务"}</h3>
            <button
              type="button"
              aria-label="取消编辑"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              ×
            </button>
          </div>
          <div className="sg-fields">
            <label>
              任务颜色
              <select
                aria-label="任务颜色"
                value={draft.color ?? "blue"}
                onChange={(event) =>
                  setDraft({ ...draft, color: event.target.value as TaskColor })
                }
              >
                {(Object.keys(taskColors) as TaskColor[]).map((color) => (
                  <option key={color} value={color}>
                    {taskColors[color]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              父任务
              <select
                aria-label="父任务"
                value={draft.parentId ?? ""}
                onChange={(event) => {
                  const next = { ...draft };
                  if (event.target.value) next.parentId = event.target.value;
                  else delete next.parentId;
                  setDraft(next);
                }}
              >
                <option value="">无 · 顶层任务</option>
                {outline(all, new Set())
                  .filter(
                    (row) =>
                      row.task.id !== draft.id &&
                      !descendants(raw, draft.id).has(row.task.id) &&
                      !row.task.milestone,
                  )
                  .map((row) => (
                    <option key={row.task.id} value={row.task.id}>
                      {"　".repeat(row.depth)}
                      {row.task.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              任务名称
              <input
                autoFocus
                required
                maxLength={120}
                value={draft.title}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
              />
            </label>
            <label>
              负责人
              <input
                maxLength={80}
                value={draft.owner ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, owner: event.target.value })
                }
              />
            </label>
            <label>
              开始日期
              <input
                type="date"
                required
                disabled={raw.some((child) => child.parentId === draft.id)}
                value={draft.start}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    start: event.target.value,
                    ...(draft.milestone ? { end: event.target.value } : {}),
                  })
                }
              />
            </label>
            <label>
              {draft.milestone ? "里程碑日期" : "结束日期"}
              <input
                type="date"
                required
                disabled={
                  draft.milestone ||
                  raw.some((child) => child.parentId === draft.id)
                }
                min={draft.start}
                value={draft.end}
                onChange={(event) =>
                  setDraft({ ...draft, end: event.target.value })
                }
              />
            </label>
            <label>
              阶段
              <input
                maxLength={80}
                value={draft.phase ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, phase: event.target.value })
                }
              />
            </label>
            <label>
              进度 · {draft.progress}%
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                disabled={raw.some((child) => child.parentId === draft.id)}
                value={draft.progress}
                onChange={(event) =>
                  setDraft({ ...draft, progress: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <label className="sg-check">
            <input
              type="checkbox"
              checked={!!draft.milestone}
              disabled={raw.some((child) => child.parentId === draft.id)}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  milestone: event.target.checked,
                  ...(event.target.checked ? { end: draft.start } : {}),
                })
              }
            />
            里程碑
          </label>
          <fieldset>
            <legend>前置任务</legend>
            {all
              .filter((task) => task.id !== draft.id)
              .map((task) => (
                <label className="sg-check" key={task.id}>
                  <input
                    type="checkbox"
                    checked={(draft.dependencies ?? []).includes(task.id)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        dependencies: event.target.checked
                          ? [...(draft.dependencies ?? []), task.id]
                          : (draft.dependencies ?? []).filter(
                              (id) => id !== task.id,
                            ),
                      })
                    }
                  />
                  {task.title}
                </label>
              ))}
            {all.length <= (isNew ? 0 : 1) && <span>暂无其他任务</span>}
          </fieldset>
          <div className="sg-form-actions">
            {!isNew && (
              <button
                type="button"
                className="sg-delete"
                onClick={() => {
                  if (
                    commit(
                      removeTask(data, draft.id),
                      "任务已删除，子任务已提升一层，相关依赖已移除",
                    )
                  ) {
                    setDraft(null);
                    setSelected(null);
                  }
                }}
              >
                删除任务
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              取消
            </button>
            <button type="submit" className="sg-primary">
              保存任务
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="sg-danger">
          {error}
        </p>
      )}
      <div className="sg-announcement" aria-live="polite" id={`${uid}-status`}>
        {message}
      </div>
    </section>
  );
}

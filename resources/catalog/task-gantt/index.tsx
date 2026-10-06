import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import {
  conflicts,
  date,
  day,
  removeTask,
  shift,
  status,
  today,
  validate,
  type GanttData,
  type Task,
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
  const all = data.tasks;
  const rows = all.filter(
    (task) =>
      `${task.title} ${task.owner ?? ""} ${task.phase ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "全部状态" || status(task, current) === filter),
  );
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
  const completed = all.filter((task) => task.progress === 100).length;
  const late = all.filter((task) => status(task, current) === "已逾期").length;
  const mean = all.length
    ? Math.round(
        all.reduce((total, task) => total + task.progress, 0) / all.length,
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
  function begin(task?: Task) {
    setError(null);
    setIsNew(!task);
    setDraft(
      task
        ? { ...task, dependencies: [...(task.dependencies ?? [])] }
        : {
            id: `task-${crypto.randomUUID()}`,
            title: "",
            start: current,
            end: date(day(current) + 3),
            progress: 0,
            owner: "",
            phase: "",
            dependencies: [],
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
    const next = shift(active.task, active.delta, active.mode);
    commit(
      {
        ...data,
        tasks: all.map((task) => (task.id === next.id ? next : task)),
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
          <span className="sg-eyebrow">项目排期</span>
          <h2>{data.title}</h2>
          {data.description && <p>{data.description}</p>}
        </div>
        <span className="sg-mode">{readOnly ? "阅读模式" : "可编辑"}</span>
      </header>
      <div className="sg-summary">
        <span>
          <strong>{all.length}</strong> 个任务
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
      <div className="sg-toolbar">
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
          {rows.length} 个任务
          {readOnly ? " · 点击查看详情" : " · 拖动条形调整日期"}
        </span>
      </div>
      <div className="sg-grid">
        <div className="sg-axis">
          <span>任务 / 负责人</span>
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
        {rows.map((original, index) => {
          const task =
            drag?.task.id === original.id
              ? shift(original, drag.delta, drag.mode)
              : original;
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
              className={`sg-row ${selected === task.id ? "sg-selected" : ""}`}
              key={task.id}
            >
              <button
                type="button"
                className="sg-task"
                onClick={() => {
                  setSelected(task.id);
                  setDraft(null);
                }}
                aria-pressed={selected === task.id}
              >
                <span className="sg-task-title">
                  <span
                    className={`sg-dot ${task.progress === 100 ? "sg-done" : state === "已逾期" ? "sg-late" : ""}`}
                  />
                  {task.title}
                </span>
                <span className="sg-meta">
                  {task.phase ? `${task.phase} · ` : ""}
                  {task.owner || "未分配"} · {state}
                  {issues.length > 0 ? " · 依赖冲突" : ""}
                </span>
              </button>
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
                  >
                    <span>{index === 0 ? "今天" : ""}</span>
                  </i>
                )}
                {visible ? (
                  <div
                    className={`sg-bar-wrap ${task.milestone ? "sg-is-milestone" : ""}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    <button
                      type="button"
                      className={`sg-bar ${task.progress === 100 ? "sg-done" : state === "已逾期" ? "sg-late" : ""}`}
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
                    {!readOnly && onChange && !task.milestone && width > 3 && (
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
        <span>浅色列为周末</span>
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
              <button
                type="button"
                onClick={() =>
                  commit(
                    {
                      ...data,
                      tasks: all.map((task) =>
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
                    ? [...all, task]
                    : all.map((item) => (item.id === task.id ? task : item)),
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
                disabled={draft.milestone}
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
                      "任务已删除，相关依赖已移除",
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

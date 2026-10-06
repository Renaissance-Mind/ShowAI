export type Task = {
  id: string;
  title: string;
  start: string;
  end: string;
  progress: number;
  owner?: string;
  phase?: string;
  dependencies?: string[];
  milestone?: boolean;
};
export type GanttData = { title: string; description?: string; tasks: Task[] };
export const DAY = 86_400_000;
export function day(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value
    ? time / DAY
    : NaN;
}
export const date = (value: number) =>
  new Date(value * DAY).toISOString().slice(0, 10);
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function validate(data: GanttData): string | null {
  if (!data || typeof data.title !== "string" || !Array.isArray(data.tasks))
    return "需要标题和任务列表。";
  if (data.tasks.length > 200) return "最多支持 200 个任务。";
  const ids = new Set<string>();
  for (const task of data.tasks) {
    if (!task.id || ids.has(task.id)) return "任务 ID 必须唯一。";
    ids.add(task.id);
    if (typeof task.title !== "string" || !task.title.trim())
      return "请填写任务名称。";
    if (!Number.isFinite(day(task.start)) || !Number.isFinite(day(task.end)))
      return "请填写有效的起止日期。";
    if (task.end < task.start) return "结束日期不能早于开始日期。";
    if (task.milestone && task.start !== task.end)
      return "里程碑的起止日期必须相同。";
    if (
      !Number.isInteger(task.progress) ||
      task.progress < 0 ||
      task.progress > 100
    )
      return "进度必须是 0 到 100 的整数。";
    if (
      task.dependencies &&
      (!Array.isArray(task.dependencies) ||
        new Set(task.dependencies).size !== task.dependencies.length)
    )
      return "依赖任务不能重复。";
  }
  const byId = new Map(data.tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function cycle(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dep of byId.get(id)?.dependencies ?? []) {
      if (!ids.has(dep)) throw new Error("missing-dependency");
      if (cycle(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  for (const task of data.tasks) {
    if ((task.dependencies ?? []).some((dep) => !ids.has(dep)))
      return "依赖任务不存在。";
  }
  if (data.tasks.some((task) => cycle(task.id)))
    return "依赖关系不能形成循环。";
  if (
    data.tasks.length &&
    Math.max(...data.tasks.map((task) => day(task.end))) -
      Math.min(...data.tasks.map((task) => day(task.start))) >
      3650
  )
    return "项目时间跨度不能超过 10 年。";
  return null;
}
export function shift(
  task: Task,
  delta: number,
  mode: "move" | "start" | "end",
): Task {
  const start = day(task.start),
    end = day(task.end);
  if (mode === "move" || task.milestone)
    return { ...task, start: date(start + delta), end: date(end + delta) };
  return mode === "start"
    ? { ...task, start: date(Math.min(end, start + delta)) }
    : { ...task, end: date(Math.max(start, end + delta)) };
}
export function removeTask(data: GanttData, id: string): GanttData {
  return {
    ...data,
    tasks: data.tasks
      .filter((task) => task.id !== id)
      .map((task) => ({
        ...task,
        dependencies: (task.dependencies ?? []).filter((dep) => dep !== id),
      })),
  };
}
export function status(task: Task, current: string): string {
  return task.progress === 100
    ? "已完成"
    : task.end < current
      ? "已逾期"
      : task.progress > 0
        ? "进行中"
        : "未开始";
}
export function conflicts(task: Task, tasks: Task[]): Task[] {
  return tasks.filter(
    (dep) =>
      (task.dependencies ?? []).includes(dep.id) && dep.end >= task.start,
  );
}

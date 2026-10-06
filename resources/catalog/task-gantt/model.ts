export const taskColors = {
  blue: "蓝色",
  purple: "紫色",
  amber: "橙色",
  rose: "粉色",
  slate: "灰色",
};
export type TaskColor = keyof typeof taskColors;
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
  parentId?: string;
  color?: TaskColor;
};
export const columnLabels = {
  title: "任务",
  owner: "负责人",
  status: "状态",
  phase: "阶段",
  progress: "进度",
  start: "开始",
  end: "结束",
};
export type Column = keyof typeof columnLabels;
export const defaultColumns: Column[] = ["title", "owner", "status"];
export type GanttData = {
  title: string;
  description?: string;
  tasks: Task[];
  columns?: Column[];
};
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
  if (
    data.columns &&
    (!Array.isArray(data.columns) ||
      data.columns[0] !== "title" ||
      new Set(data.columns).size !== data.columns.length ||
      data.columns.some((column) => !(column in columnLabels)))
  )
    return "显示列需要以任务列开头，且不能重复。";
  const ids = new Set<string>();
  for (const task of data.tasks) {
    if (!task.id || ids.has(task.id)) return "任务 ID 必须唯一。";
    if (task.color && !Object.hasOwn(taskColors, task.color))
      return "请选择有效的任务颜色。";
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
  for (const task of data.tasks) {
    const chain = new Set([task.id]);
    let parent = task.parentId;
    while (parent) {
      if (!byId.has(parent)) return "父任务不存在。";
      if (chain.has(parent)) return "任务嵌套不能形成循环。";
      chain.add(parent);
      parent = byId.get(parent)!.parentId;
    }
    if (
      task.milestone &&
      data.tasks.some((child) => child.parentId === task.id)
    )
      return "里程碑不能包含子任务。";
  }
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
  const parentId = data.tasks.find((task) => task.id === id)?.parentId;
  return {
    ...data,
    tasks: data.tasks
      .filter((task) => task.id !== id)
      .map((task) => ({
        ...task,
        ...(task.parentId === id ? { parentId } : {}),
        dependencies: (task.dependencies ?? []).filter((dep) => dep !== id),
      }))
      .map((task) => {
        if (!task.parentId) delete task.parentId;
        return task;
      }),
  };
}
export function descendants(tasks: Task[], id: string): Set<string> {
  const result = new Set<string>();
  const visit = (parent: string) => {
    for (const task of tasks.filter((task) => task.parentId === parent)) {
      if (result.has(task.id)) continue;
      result.add(task.id);
      visit(task.id);
    }
  };
  visit(id);
  return result;
}
/** Summary rows derive their dates and progress from leaf tasks, counted once. */
export function summarize(tasks: Task[]): Task[] {
  const parents = new Set(tasks.map((task) => task.parentId).filter(Boolean));
  return tasks.map((task) => {
    if (!parents.has(task.id)) return task;
    const children = descendants(tasks, task.id);
    const leaves = tasks.filter(
      (child) => children.has(child.id) && !parents.has(child.id),
    );
    return {
      ...task,
      milestone: false,
      start: date(Math.min(...leaves.map((child) => day(child.start)))),
      end: date(Math.max(...leaves.map((child) => day(child.end)))),
      progress: Math.round(
        leaves.reduce((sum, child) => sum + child.progress, 0) / leaves.length,
      ),
    };
  });
}
export type OutlineRow = {
  task: Task;
  depth: number;
  childCount: number;
  matched: boolean;
};
export function outline(
  tasks: Task[],
  collapsed: Set<string>,
  matches?: (task: Task) => boolean,
): OutlineRow[] {
  const result: OutlineRow[] = [];
  const included = new Set<string>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (matches)
    for (const task of tasks.filter(matches)) {
      included.add(task.id);
      let parent = task.parentId;
      while (parent) {
        included.add(parent);
        parent = byId.get(parent)?.parentId;
      }
    }
  function visit(parentId: string | undefined, depth: number) {
    for (const task of tasks.filter((task) => task.parentId === parentId)) {
      if (matches && !included.has(task.id)) continue;
      const childCount = tasks.filter(
        (child) => child.parentId === task.id,
      ).length;
      result.push({
        task,
        depth,
        childCount,
        matched: !matches || matches(task),
      });
      if (matches || !collapsed.has(task.id)) visit(task.id, depth + 1);
    }
  }
  visit(undefined, 0);
  return result;
}
export function shiftBranch(
  tasks: Task[],
  id: string,
  delta: number,
  mode: "move" | "start" | "end",
): Task[] {
  const children = descendants(tasks, id);
  if (children.size && mode !== "move") return tasks;
  return tasks.map((task) =>
    task.id === id || (mode === "move" && children.has(task.id))
      ? shift(task, delta, mode)
      : task,
  );
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

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import TaskGantt from "../../resources/catalog/task-gantt/index";
import sample from "./data.json";
import {
  validate,
  type GanttData,
} from "../../resources/catalog/task-gantt/model";
const root = document.getElementById("showai-task-gantt-preview");
if (!root) throw new Error("Preview root missing");
const host = window as typeof window & {
  openai?: {
    widgetState?: {
      privateContent?: { gantt?: GanttData; previewVersion?: string };
    };
    setWidgetState?: (state: unknown) => Promise<void>;
  };
};
function Preview() {
  const saved =
    host.openai?.widgetState?.privateContent?.previewVersion === "1.1.0"
      ? host.openai.widgetState.privateContent.gantt
      : undefined;
  const [data, setData] = useState<GanttData>(
    applySampleColors(
      saved && !validate(saved) ? saved : (sample as GanttData),
    ),
  );
  useEffect(() => {
    const restore = (event: Event) => {
      const state = (event as CustomEvent).detail?.globals?.widgetState
        ?.privateContent;
      if (
        state?.previewVersion === "1.1.0" &&
        state.gantt &&
        !validate(state.gantt)
      )
        setData(applySampleColors(state.gantt));
    };
    window.addEventListener("openai:set_globals", restore);
    return () => window.removeEventListener("openai:set_globals", restore);
  }, []);
  return (
    <TaskGantt
      data={data}
      readOnly={false}
      onChange={(next) => {
        setData(next);
        const state = {
          modelContent: {
            component: "task-gantt",
            taskCount: next.tasks.length,
          },
          privateContent: { gantt: next, previewVersion: "1.1.0" },
        };
        if (
          new TextEncoder().encode(JSON.stringify(state)).byteLength <
          16 * 1024
        )
          host.openai?.setWidgetState?.(state).catch(() => {});
      }}
    />
  );
}
function applySampleColors(data: GanttData): GanttData {
  const palette = new Map(
    (sample as GanttData).tasks.map((task) => [task.id, task.color]),
  );
  return {
    ...data,
    tasks: data.tasks.map((task) => ({
      ...task,
      color: task.color ?? palette.get(task.id) ?? "blue",
    })),
  };
}
createRoot(root).render(<Preview />);

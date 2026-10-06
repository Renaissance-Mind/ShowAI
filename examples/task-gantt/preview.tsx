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
    widgetState?: { privateContent?: { gantt?: GanttData } };
    setWidgetState?: (state: unknown) => Promise<void>;
  };
};
function Preview() {
  const saved = host.openai?.widgetState?.privateContent?.gantt;
  const [data, setData] = useState<GanttData>(
    saved && !validate(saved) ? saved : sample,
  );
  useEffect(() => {
    const restore = (event: Event) => {
      const next = (event as CustomEvent).detail?.globals?.widgetState
        ?.privateContent?.gantt;
      if (next && !validate(next)) setData(next);
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
          privateContent: { gantt: next },
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
createRoot(root).render(<Preview />);

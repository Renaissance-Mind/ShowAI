import { Activity, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PortableInputScope } from "../portable-input-scope";
import { HistoryTravelQueue } from "../history-travel-queue";
import { useScopeLifecycle } from "../useScopeLifecycle";

let activeScope: PortableInputScope;
let activeHistory: HistoryTravelQueue;
function ScopeOwner() {
  const [scope] = useState(() => {
    const value = new PortableInputScope(() => {
      throw new Error("No stroke is submitted by this lifecycle fixture");
    });
    return value;
  });
  const [history] = useState(() => {
    const value = new HistoryTravelQueue();
    return value;
  });
  activeScope = scope;
  activeHistory = history;
  useScopeLifecycle(scope, "Input cleanup failed");
  useScopeLifecycle(history, "History cleanup failed");
  return <Consumer scope={scope} history={history} />;
}
function Consumer({
  scope,
  history,
}: {
  scope: PortableInputScope;
  history: HistoryTravelQueue;
}) {
  const [ready, setReady] = useState(0);
  useEffect(() => {
    void scope.client;
    void history.enqueue(async () => {
      setReady((value) => value + 1);
    });
  }, [scope, history]);
  return <output data-ready>{ready}</output>;
}
function App() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button onClick={() => setVisible((value) => !value)}>Toggle page</button>
      <button onClick={() => setMounted(false)}>Close page</button>
      {mounted && (
        <Activity mode={visible ? "visible" : "hidden"}>
          <ScopeOwner />
        </Activity>
      )}
    </>
  );
}
Object.assign(window, {
  retired: () => {
    const scope = activeScope;
    if (!scope) return false;
    try {
      void scope.client;
      return false;
    } catch (error) {
      return String(error).includes("retired");
    }
  },
  historyStopped: async () => {
    try {
      await activeHistory.enqueue(async () => {});
      return false;
    } catch (error) {
      return String(error).includes("retiring");
    }
  },
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

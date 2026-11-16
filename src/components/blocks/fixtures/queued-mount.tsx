import { Activity, StrictMode, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MountQueue, MountQueueContext, useQueuedMount } from "../mount-queue";
import {
  ReaderStateContext,
  ReaderStateStore,
} from "../../../surface/reader-state";

const store = new ReaderStateStore(localStorage);
const report = {
  anchor: 0,
  expected: [] as string[],
  firstFrame: [] as string[],
};
Object.assign(window, { queuedMountReport: report });
const parameters = new URLSearchParams(location.search);

function NestedComponent() {
  const queued = useQueuedMount();
  return (
    <section style={{ padding: 7 }}>
      {queued.mounted ? (
        <div data-mounted="nested" style={{ height: 80 }} />
      ) : (
        <div ref={queued.placeholder} style={{ height: queued.height ?? 30 }} />
      )}
    </section>
  );
}

function Component({ id }: { id: number }) {
  const queued = useQueuedMount();
  const [clicked, setClicked] = useState(false);
  return (
    <section
      data-component={id}
      style={{
        padding: "10px 0",
        borderTop: "2px solid transparent",
        borderBottom: "4px solid transparent",
        boxSizing: "border-box",
      }}
    >
      <div data-anchor={id} />
      {queued.mounted ? (
        <div data-mounted={id} style={{ height: 400 }}>
          <button onClick={() => setClicked(true)}>
            {clicked ? "Kept" : `Component ${id}`}
          </button>
          {id === 6 && (
            <ReaderStateContext.Provider
              value={{ store, page: "queued-page", block: "nested" }}
            >
              <NestedComponent />
            </ReaderStateContext.Provider>
          )}
        </div>
      ) : (
        <div
          ref={queued.placeholder}
          data-placeholder={id}
          style={{ height: queued.height ?? 180 }}
        />
      )}
    </section>
  );
}

function Content() {
  useLayoutEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".container-page")!;
    if (scroller.querySelectorAll("[data-mounted]").length === 9) return;
    scroller.scrollTop = 1236;
    report.anchor = document
      .querySelector('[data-anchor="6"]')!
      .getBoundingClientRect().top;
    report.expected = [
      ...scroller.querySelectorAll<HTMLElement>("[data-placeholder]"),
    ]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom >= -200 && rect.top <= innerHeight + 200;
      })
      .map((element) => element.dataset.placeholder!);
    const frame = requestAnimationFrame(() => {
      report.firstFrame = [
        ...scroller.querySelectorAll<HTMLElement>("[data-mounted]"),
      ].map((element) => element.dataset.mounted!);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      className="container-page"
      style={{
        height: 300,
        overflow: "auto",
        overflowAnchor: "none",
        transform: `scale(${parameters.get("scale") ?? 1})`,
        transformOrigin: "top left",
      }}
    >
      {Array.from({ length: 8 }, (_, id) => (
        <ReaderStateContext.Provider
          key={id}
          value={{ store, page: "queued-page", block: `component-${id}` }}
        >
          <Component id={id} />
        </ReaderStateContext.Provider>
      ))}
    </div>
  );
}

function Fixture() {
  const [queue] = useState(() => new MountQueue());
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button onClick={() => setVisible(!visible)}>Toggle page</button>
      <MountQueueContext.Provider value={queue}>
        <Activity mode={visible ? "visible" : "hidden"}>
          <Content />
        </Activity>
      </MountQueueContext.Provider>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);

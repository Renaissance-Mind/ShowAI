export function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, p50: null, p95: null, max: null };
  const percentile = (p) =>
    sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return {
    count: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1),
  };
}

export function installInteractionProbe() {
  const state = {
    events: [],
    longTasks: [],
    longFrames: [],
    frames: [],
    inputs: [],
    calls: [],
    active: false,
    previous: 0,
  };
  const observe = (type, accept, extra = {}) => {
    if (PerformanceObserver.supportedEntryTypes.includes(type))
      new PerformanceObserver((list) =>
        list.getEntries().forEach(accept),
      ).observe({ type, buffered: true, ...extra });
  };
  observe(
    "event",
    (e) =>
      state.events.push({
        name: e.name,
        start: e.startTime,
        delay: e.processingStart - e.startTime,
        processing: e.processingEnd - e.processingStart,
        duration: e.duration,
        interactionId: e.interactionId,
      }),
    { durationThreshold: 16 },
  );
  observe("longtask", (e) =>
    state.longTasks.push({ start: e.startTime, duration: e.duration }),
  );
  observe("long-animation-frame", (e) =>
    state.longFrames.push({
      start: e.startTime,
      duration: e.duration,
      blocking: e.blockingDuration,
      renderStart: e.renderStart,
      styleAndLayoutStart: e.styleAndLayoutStart,
      scripts: e.scripts?.map((s) => ({
        url: s.sourceURL,
        function: s.sourceFunctionName,
        duration: s.duration,
        forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration,
      })),
    }),
  );
  for (const type of [
    "pointerdown",
    "pointermove",
    "pointerup",
    "click",
    "keydown",
    "wheel",
  ])
    addEventListener(
      type,
      (e) => {
        if (state.active)
          state.inputs.push({
            type,
            at: performance.now(),
            eventAt: e.timeStamp,
            trusted: e.isTrusted,
            x: e.clientX,
            y: e.clientY,
            objectId:
              e.target instanceof Element
                ? e.target
                    .closest("[data-surface-id]")
                    ?.getAttribute("data-surface-id")
                : null,
          });
      },
      true,
    );
  const tick = (time) => {
    if (!state.active) return;
    if (state.previous) state.frames.push(time - state.previous);
    state.previous = time;
    requestAnimationFrame(tick);
  };
  window.__interactionPerf = {
    begin() {
      if (state.active) throw new Error("An interaction is already measured");
      state.active = true;
      state.frames = [];
      state.inputs = [];
      state.previous = 0;
      state.start = performance.now();
      performance.mark("showai:perf:start");
      requestAnimationFrame(tick);
      return state.start;
    },
    end() {
      state.end = performance.now();
      state.active = false;
      performance.mark("showai:perf:end");
      return state.end;
    },
    read() {
      const inside = (e) => e.start >= state.start && e.start < state.end;
      const first = state.inputs.find((e) => e.type !== "pointermove");
      const release = state.inputs.findLast((e) => e.type === "pointerup");
      return {
        start: state.start,
        end: state.end,
        driverToReadyMs: state.end - state.start,
        inputToReadyMs: first ? state.end - first.eventAt : null,
        releaseToReadyMs: release ? state.end - release.eventAt : null,
        inputCount: state.inputs.length,
        inputs: state.inputs,
        trustedInput:
          state.inputs.length > 0 && state.inputs.every((e) => e.trusted),
        rafIntervals: state.frames,
        events: state.events.filter(inside),
        longTasks: state.longTasks.filter(inside),
        longFrames: state.longFrames.filter(inside),
        calls: state.calls.filter(inside),
      };
    },
    attachHost() {
      const original = window.showai.invoke;
      window.showai.invoke = async function (action, args) {
        const start = performance.now();
        try {
          return await original.call(this, action, args);
        } finally {
          state.calls.push({
            action,
            start,
            duration: performance.now() - start,
          });
        }
      };
    },
  };
}

export function profileSummary(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const totals = new Map();
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    const frame = nodes.get(profile.samples[i])?.callFrame;
    if (!frame) continue;
    const key = `${frame.functionName || "(anonymous)"} @ ${frame.url}:${frame.lineNumber + 1}`;
    totals.set(
      key,
      (totals.get(key) ?? 0) + (profile.timeDeltas?.[i] ?? 0) / 1000,
    );
  }
  return [...totals]
    .map(([frame, selfMs]) => ({ frame, selfMs }))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 20);
}

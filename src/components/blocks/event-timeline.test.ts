import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventTimelineBlock } from "./EventTimeline";
import {
  axisPointLabel,
  eventAt,
  initialPoint,
  phaseAt,
  pointCount,
  validateEventTimelineData,
} from "./event-timeline-contract.mjs";

// A small incident-shaped timeline: one point per minute from 13:50.
const sample = (): any => ({
  title: "Checkout incident",
  axis: { type: "clock", start: "13:50", label: "Time" },
  series: [
    {
      id: "errors",
      label: "Error rate",
      unit: "%",
      tone: "bad",
      area: true,
      values: [0.3, 0.4, 6, 31, 58, 62, null, 21, 4, 0.5],
    },
    {
      id: "p99",
      label: "p99",
      unit: "s",
      axis: "right",
      dashed: true,
      max: 12,
      values: [0.8, 0.8, 4.1, 9.3, 10, 10, 10, 4.4, 1.6, 0.9],
    },
  ],
  phases: [
    { from: 1, to: 3, label: "Detect", tone: "warn" },
    { from: 3, to: 6, label: "Diagnose", tone: "bad" },
    { from: 6, to: 9, label: "Recover", tone: "good" },
  ],
  kinds: [
    { id: "trigger", label: "Trigger", tone: "warn" },
    { id: "act", label: "Action", tone: "info" },
  ],
  events: [
    {
      at: 1,
      kind: "trigger",
      title: "Config pushed",
      detail: "Retries 1 → 3.",
    },
    { at: 3, kind: "act", title: "Incident declared", detail: "SEV-2 opened." },
    { at: 3, kind: "act", title: "Status page updated" },
    { at: 6, kind: "act", title: "Rollback", detail: "Retries back to 1." },
  ],
  summary: [{ label: "Peak error rate", value: "62%", tone: "bad" }],
  initialAt: 4,
  note: "Sample data.",
});

const render = (data: unknown) =>
  renderToStaticMarkup(
    createElement(EventTimelineBlock, {
      data: data as Record<string, unknown>,
      readOnly: true,
    }),
  );

describe("event timeline contract", () => {
  it("accepts a full timeline and infers the point count from the series", () => {
    const data = sample();
    expect(() => validateEventTimelineData(data)).not.toThrow();
    expect(pointCount(data)).toBe(10);
  });

  it("accepts events without series when axis.count is given", () => {
    const data = {
      axis: { type: "number", count: 5 },
      events: [{ at: 4, title: "Done" }],
    };
    expect(() => validateEventTimelineData(data)).not.toThrow();
    const missing = { axis: { type: "number" }, events: [] };
    expect(() => validateEventTimelineData(missing)).toThrow(/axis.count/);
  });

  it("rejects series that do not match the axis", () => {
    const short = sample();
    short.series[1].values.pop();
    expect(() => validateEventTimelineData(short)).toThrow(
      /series\[1\].values must have 10 values/,
    );
    const counted = sample();
    counted.axis.count = 12;
    expect(() => validateEventTimelineData(counted)).toThrow(/12 values/);
    const duplicate = sample();
    duplicate.series[1].id = "errors";
    expect(() => validateEventTimelineData(duplicate)).toThrow(/duplicate id/);
    const text = sample();
    text.series[0].values[2] = "6";
    expect(() => validateEventTimelineData(text)).toThrow(
      /series\[0\].values\[2\]/,
    );
  });

  it("checks positions, order and references with the field path", () => {
    const outside = sample();
    outside.events[3].at = 10;
    expect(() => validateEventTimelineData(outside)).toThrow(
      /events\[3\].at must be a point index from 0 to 9/,
    );
    const order = sample();
    order.events[0].at = 5;
    expect(() => validateEventTimelineData(order)).toThrow(/time order/);
    const kind = sample();
    kind.events[1].kind = "detect";
    expect(() => validateEventTimelineData(kind)).toThrow(
      /events\[1\].kind detect is not a defined kind/,
    );
    const overlap = sample();
    overlap.phases[1].from = 2;
    expect(() => validateEventTimelineData(overlap)).toThrow(/overlaps/);
    const tone = sample();
    tone.phases[0].tone = "red";
    expect(() => validateEventTimelineData(tone)).toThrow(/phases\[0\].tone/);
    const initial = sample();
    initial.initialAt = -1;
    expect(() => validateEventTimelineData(initial)).toThrow(/initialAt/);
  });

  it("validates each axis type's start", () => {
    for (const axis of [
      { type: "clock", start: "25:00" },
      { type: "date", start: "2026-02-30" },
      { type: "number", start: "1" },
      { type: "date", start: "2026-02-01", step: 0.5 },
    ]) {
      const data = sample();
      data.axis = axis;
      expect(() => validateEventTimelineData(data), axis.type).toThrow(
        /axis\./,
      );
    }
  });

  it("labels points for each axis type", () => {
    expect(axisPointLabel({ type: "clock", start: "23:50", step: 5 }, 3)).toBe(
      "00:05",
    );
    expect(
      axisPointLabel(
        { type: "date", start: "2026-09-29", step: 1 },
        3,
        "en-US",
      ),
    ).toBe("10/2");
    expect(
      axisPointLabel({ type: "number", start: 1, prefix: "Day ", unit: "" }, 2),
    ).toBe("Day 3");
    expect(axisPointLabel({ type: "number", step: 0.5, unit: "s" }, 3)).toBe(
      "1.5s",
    );
  });

  it("finds the latest event and the phase at a point", () => {
    const { events, phases } = sample();
    expect(eventAt(events, 0)).toBe(-1);
    expect(eventAt(events, 3)).toBe(2);
    expect(eventAt(events, 5)).toBe(2);
    expect(eventAt(events, 9)).toBe(3);
    expect(phaseAt(phases, 0)).toBe(-1);
    expect(phaseAt(phases, 3)).toBe(1);
    expect(phaseAt(phases, 9)).toBe(2);
    expect(initialPoint(sample())).toBe(4);
    expect(initialPoint({ ...sample(), initialAt: undefined })).toBe(1);
  });
});

describe("event timeline block", () => {
  it("opens the latest event before the cursor and dims later ones", () => {
    const html = render(sample());
    const items = html.match(/<li[ >][^>]*>/g)!;
    expect(items).toHaveLength(4);
    expect(items[2]).toContain("is-open");
    expect(items[3]).toContain("is-future");
    expect(items[0]).not.toMatch(/is-open|is-future/);
    expect(html).toContain('aria-current="step"');
    // The cursor sits on 13:54 with both series values read out.
    expect(html).toContain("13:54");
    expect(html).toContain("58%");
    expect(html).toContain("10s");
  });

  it("keeps every event detail in the markup for print and static reading", () => {
    const html = render(sample());
    for (const detail of [
      "Retries 1 → 3.",
      "SEV-2 opened.",
      "Retries back to 1.",
    ])
      expect(html).toContain(detail);
    expect(html).toContain("Diagnose");
    expect(html).toContain("Peak error rate");
    expect(html).toContain('type="range"');
    expect(html).toContain('max="9"');
  });

  it("draws gaps for missing values and one marker per event", () => {
    const html = render(sample());
    expect(html.match(/class="et-marker/g)).toHaveLength(4);
    // A null value splits the error line into two runs.
    const paths = [...html.matchAll(/<path d="([^"]+)" class="et-line"/g)];
    expect(paths[0][1].match(/M/g)).toHaveLength(2);
  });

  it("renders a timeline without series or kinds", () => {
    const html = render({
      axis: { type: "date", start: "2026-10-01", count: 4 },
      events: [{ at: 2, title: "Launch" }],
      initialAt: 0,
    });
    expect(html).toContain("Launch");
    expect(html).not.toContain("et-line");
    expect(html).toContain("is-future");
  });
});

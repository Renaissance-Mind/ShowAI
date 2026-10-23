import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PENDING_DELAY_MS, scheduleDelayedFlag } from "./delayed-flag";

describe("delayed loading flag", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("stays hidden for a load that finishes within the delay", () => {
    const reports: boolean[] = [];
    const cancel = scheduleDelayedFlag(true, PENDING_DELAY_MS, (value) =>
      reports.push(value),
    );
    vi.advanceTimersByTime(PENDING_DELAY_MS - 1);
    cancel();
    vi.advanceTimersByTime(1000);
    expect(reports).toEqual([]);
  });

  test("shows once the load outlasts the delay", () => {
    const reports: boolean[] = [];
    scheduleDelayedFlag(true, PENDING_DELAY_MS, (value) => reports.push(value));
    vi.advanceTimersByTime(PENDING_DELAY_MS);
    expect(reports).toEqual([true]);
  });

  test("hides immediately when the load ends", () => {
    const reports: boolean[] = [];
    scheduleDelayedFlag(false, PENDING_DELAY_MS, (value) => reports.push(value));
    expect(reports).toEqual([false]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a zero delay shows at once", () => {
    const reports: boolean[] = [];
    scheduleDelayedFlag(true, 0, (value) => reports.push(value));
    expect(reports).toEqual([true]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MountQueue } from "./mount-queue";

/** A placeholder at a vertical position in an 800px window. */
const at = (top: number, height = 180) =>
  ({
    getBoundingClientRect: () => ({
      top,
      bottom: top + height,
      width: height ? 600 : 0,
      height,
    }),
  }) as unknown as HTMLElement;

describe("component mount queue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { innerHeight: 800, setTimeout, clearTimeout });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("mounts bodies near the view first, then in page order, three per batch", () => {
    const queue = new MountQueue();
    const mounted: string[] = [];
    const releases = new Map<string, () => void>();
    const request = (name: string, element: HTMLElement) =>
      releases.set(
        name,
        queue.request(element, () => mounted.push(name)),
      );
    request("top", at(-5000));
    request("far below", at(9000));
    request("hidden", at(0, 0));
    request("next screen", at(1200));
    request("just above", at(-600));
    vi.runOnlyPendingTimers();
    expect(mounted).toEqual(["next screen", "just above", "top"]);
    // The next batch waits until every body of this one has committed.
    releases.get("next screen")!();
    releases.get("just above")!();
    vi.runOnlyPendingTimers();
    expect(mounted).toHaveLength(3);
    releases.get("top")!();
    vi.runOnlyPendingTimers();
    expect(mounted).toEqual([
      "next screen",
      "just above",
      "top",
      "far below",
      "hidden",
    ]);
  });

  it("drops a placeholder that goes away and mounts the rest for printing", () => {
    const queue = new MountQueue();
    const mounted: string[] = [];
    const release = queue.request(at(5000), () => mounted.push("removed"));
    queue.request(at(6000), () => mounted.push("kept"));
    release();
    queue.flush();
    vi.runOnlyPendingTimers();
    expect(mounted).toEqual(["kept"]);
  });
});

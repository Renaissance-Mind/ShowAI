import { describe, expect, it } from "vitest";
import { SWIPE_IDLE, WorkspaceSwipe, type SwipeInput } from "./workspace-swipe";

const input = (deltaX: number, deltaY = 0): SwipeInput => ({
  deltaX,
  deltaY,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  defaultPrevented: false,
});
const available = { blocked: false, canBack: true, canForward: true };

describe("workspace swipe navigation", () => {
  it.each([-1, 1] as const)(
    "previews and navigates in direction %s once per burst",
    (direction) => {
      const swipe = new WorkspaceSwipe();
      const preview = swipe.push(input(direction * 40), 0, available);
      expect(preview.owned).toBe(true);
      expect(preview.preview).toMatchObject({ direction, committed: false });
      expect(preview.navigate).toBeUndefined();
      expect(swipe.push(input(direction * 120), 20, available).navigate).toBe(
        direction,
      );
      for (let now = 40; now < 1500; now += 20) {
        // The new view and availability cannot re-trigger momentum navigation.
        expect(
          swipe.push(input(direction * 20), now, {
            blocked: true,
            canBack: false,
            canForward: false,
          }),
        ).toEqual({ owned: true });
      }
      expect(
        swipe.push(input(direction * 160), 1500 + SWIPE_IDLE, available)
          .navigate,
      ).toBe(direction);
    },
  );

  it("keeps a gesture that began over a Board or horizontal scroller with its content", () => {
    const swipe = new WorkspaceSwipe();
    expect(
      swipe.push(input(-40), 0, { ...available, blocked: true }).owned,
    ).toBe(false);
    expect(swipe.push(input(-240), 30, available)).toEqual({ owned: false });
    expect(
      swipe.push(input(-160), 30 + SWIPE_IDLE + 1, available).navigate,
    ).toBe(-1);
  });

  it("keeps vertical and diagonal reading gestures even when the tail turns horizontal", () => {
    for (const first of [input(0, 30), input(20, 20)]) {
      const swipe = new WorkspaceSwipe();
      expect(swipe.push(first, 0, available).owned).toBe(false);
      expect(swipe.push(input(-200), 20, available)).toEqual({ owned: false });
    }
  });

  it("waits for intent and lets the user pull back before committing", () => {
    const swipe = new WorkspaceSwipe();
    expect(swipe.push(input(-2), 0, available).owned).toBe(false);
    expect(swipe.push(input(-78), 20, available).preview?.progress).toBeCloseTo(
      80 / 150,
    );
    expect(swipe.push(input(65), 40, available).preview?.progress).toBeCloseTo(
      15 / 150,
    );
    expect(swipe.push(input(50), 60, available).preview?.progress).toBe(0);
    // A short, abandoned gesture does not accumulate into the next one.
    expect(
      swipe.push(input(-80), 60 + SWIPE_IDLE + 1, available).navigate,
    ).toBeUndefined();
  });

  it.each([
    { deltaMode: 1 },
    { deltaMode: 2 },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { shiftKey: true },
    { defaultPrevented: true },
  ])("yields modified and component-consumed input %j", (modifier) => {
    const swipe = new WorkspaceSwipe();
    expect(
      swipe.push({ ...input(-160), ...modifier }, 0, available).owned,
    ).toBe(false);
    expect(swipe.push(input(-160), 20, available).owned).toBe(false);
  });

  it("does not show or navigate unavailable history, including a blocked window", () => {
    for (const delta of [-180, 180]) {
      const swipe = new WorkspaceSwipe();
      expect(
        swipe.push(input(delta), 0, {
          ...available,
          canBack: false,
          canForward: false,
        }),
      ).toEqual({ owned: false });
      expect(swipe.push(input(delta), 20, available).owned).toBe(false);
    }
    const swipe = new WorkspaceSwipe();
    expect(
      swipe.push(input(-180), 0, { ...available, blocked: true }).owned,
    ).toBe(false);
  });

  it("cancels a preview on Escape, pointer input, or a change of location", () => {
    const swipe = new WorkspaceSwipe();
    expect(swipe.push(input(-80), 0, available).preview).toBeDefined();
    swipe.cancel();
    expect(swipe.push(input(-180), 20, available)).toEqual({ owned: false });
    expect(
      swipe.push(input(-180), 20 + SWIPE_IDLE + 1, available).navigate,
    ).toBe(-1);
  });
});

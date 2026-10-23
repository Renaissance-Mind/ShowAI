import { expect, it } from "vitest";
import { CaptureQueue } from "./preview-queue";

it("holds captures during input, including jobs already scheduled for admission", async () => {
  const queue = new CaptureQueue(2);
  let ran = false;
  const job = queue.enqueue(async () => {
    ran = true;
  });
  queue.pause(true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(ran).toBe(false);
  queue.pause(false);
  await job;
  expect(ran).toBe(true);
});

it("fills the capture pool without exceeding its capacity", async () => {
  const queue = new CaptureQueue(2);
  let running = 0,
    peak = 0;
  await Promise.all(
    Array.from({ length: 6 }, () =>
      queue.enqueue(async () => {
        peak = Math.max(peak, ++running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running--;
      }),
    ),
  );
  expect(peak).toBe(2);
  expect(running).toBe(0);
});

it("admits visible cards ahead of nearby prefetches while keeping captures serial", async () => {
  const queue = new CaptureQueue();
  const calls: string[] = [];
  let finish!: () => void;
  const active = queue.enqueue(async () => {
    calls.push("active");
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const neighbor = queue.enqueue(
    async () => {
      calls.push("neighbor");
    },
    () => 100,
  );
  const visible = queue.enqueue(
    async () => {
      calls.push("visible");
    },
    () => 0,
  );
  expect(calls).toEqual(["active"]);
  finish();
  await Promise.all([active, neighbor, visible]);
  expect(calls).toEqual(["active", "visible", "neighbor"]);
});

it("rechecks priority at admission and continues after a failed capture", async () => {
  const queue = new CaptureQueue();
  const calls: string[] = [];
  let priority = 100;
  const failed = queue.enqueue(
    async () => {
      calls.push("failed");
      throw new Error("capture failed");
    },
    () => priority,
  );
  const next = queue.enqueue(
    async () => {
      calls.push("next");
      return 42;
    },
    () => 50,
  );
  priority = 0;
  await expect(failed).rejects.toThrow("capture failed");
  expect(await next).toBe(42);
  expect(calls).toEqual(["failed", "next"]);
});

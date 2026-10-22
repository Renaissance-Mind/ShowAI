import { expect, it } from "vitest";
import { PreviewQueue } from "./preview-work";

it("pauses queued work for input and resumes in order without concurrent rendering", async () => {
  const queue = new PreviewQueue();
  const signal = new AbortController().signal;
  const calls: string[] = [];
  let finish!: () => void;
  queue.pause(true);
  const first = queue.enqueue(async () => {
    calls.push("first");
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return 1;
  }, signal);
  const second = queue.enqueue(async () => {
    calls.push("second");
    return 2;
  }, signal);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(calls).toEqual([]);
  queue.pause(false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(calls).toEqual(["first"]);
  finish();
  expect(await Promise.all([first, second])).toEqual([1, 2]);
  expect(calls).toEqual(["first", "second"]);
});

it("removes stale offscreen jobs before they parse or render any content", async () => {
  const queue = new PreviewQueue();
  queue.pause(true);
  const controller = new AbortController();
  let executed = false;
  const job = queue.enqueue(async () => {
    executed = true;
  }, controller.signal);
  const rejected = expect(job).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  queue.pause(false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(executed).toBe(false);
  expect(
    await queue.enqueue(async () => "next", new AbortController().signal),
  ).toBe("next");
});

it("rejects failed renders and continues processing the next request", async () => {
  const queue = new PreviewQueue();
  const signal = new AbortController().signal;
  const failure = queue.enqueue(async () => {
    throw new Error("Invalid page");
  }, signal);
  const next = queue.enqueue(async () => 42, signal);
  await expect(failure).rejects.toThrow("Invalid page");
  expect(await next).toBe(42);
});

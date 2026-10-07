import { expect, it } from "vitest";
import { coalescedTask } from "./coalesced-task";
import { latestRequest } from "./latest-request";
it("merges a burst but retains one fresh follow-up", async () => {
  let release!: () => void,
    calls = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = coalescedTask(async () => {
    calls++;
    if (calls === 1) await gate;
    return calls;
  });
  const a = run(),
    b = run(),
    c = run();
  release();
  expect(await Promise.all([a, b, c])).toEqual([2, 2, 2]);
  expect(calls).toBe(2);
});
it("executes the newest waiting query and discards obsolete queued work", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = latestRequest<string>(),
    executed: string[] = [];
  const a = run(async () => {
    executed.push("first");
    await gate;
    return "first";
  });
  const b = run(async () => {
    executed.push("obsolete");
    return "obsolete";
  });
  const c = run(async () => {
    executed.push("latest");
    return "latest";
  });
  release();
  expect(await Promise.all([a, b, c])).toEqual(["latest", "latest", "latest"]);
  expect(executed).toEqual(["first", "latest"]);
});

import { expect, it } from "vitest";
import { LatestRequest } from "./latest-request";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

it("runs the latest click after the running one and skips the clicks in between", async () => {
  const events: string[] = [];
  let busy = 0;
  const gate = new LatestRequest({
    start: () => busy++,
    settle: () => busy--,
  });
  const first = deferred<void>();
  const opened: string[] = [];
  const open = (id: string, wait?: Promise<void>) =>
    gate.run(false, async (current) => {
      events.push(`start ${id}`);
      await wait;
      // A newer request arrived: this one does not show its result.
      if (!current()) return false;
      opened.push(id);
      return true;
    });

  const a = open("a", first.promise);
  const b = open("b");
  const c = open("c");
  expect(gate.busy).toBe(true);
  expect(busy).toBe(1);
  first.resolve();
  expect(await a).toBe(false);
  expect(await b).toBe(false);
  expect(await c).toBe(true);
  expect(events).toEqual(["start a", "start c"]);
  expect(opened).toEqual(["c"]);
  expect(gate.busy).toBe(false);
  expect(busy).toBe(0);
});

it("shows a request that nothing superseded and passes failures through", async () => {
  const gate = new LatestRequest();
  expect(await gate.run(0, async (current) => (current() ? 1 : 2))).toBe(1);
  await expect(
    gate.run(0, async () => {
      throw new Error("read failed");
    }),
  ).rejects.toThrow("read failed");
  // A failure frees the gate for the next request.
  expect(await gate.run(0, async () => 3)).toBe(3);
});

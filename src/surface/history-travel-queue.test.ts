import { expect, it } from "vitest";
import { HistoryTravelQueue } from "./history-travel-queue";
import {
  InkOperationReplica,
  createInkOperation,
  type InkOperation,
  type InkUndoRecord,
} from "./ink-operations.mjs";
import { createPortableInk } from "./portable-ink.mjs";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("serializes two accepted Undo clicks across a real causal append and delayed projection", async () => {
  const replica = new InkOperationReplica({ pageId: "page", boardId: "board" }),
    edges: { operation: InkOperation; undo: InkUndoRecord }[] = [];
  for (const [index, id] of ["a", "b"].entries()) {
    const operation = createInkOperation({
      actor: "device",
      sequence: index + 1,
      pageId: "page",
      boardId: "board",
      parents: [...replica.frontier],
      changes: [
        {
          kind: "create",
          strokeId: id,
          node: {
            type: "drawing",
            attrs: {
              id,
              tool: "pen",
              color: "#111111",
              strokeWidth: 2,
              extent: [40, 30],
              ink: createPortableInk(
                [
                  { x: 1, y: 2 },
                  { x: 20, y: 10 },
                ],
                2,
                [40, 30],
              ),
            },
          },
          layout: { x: 0, y: 0, width: 40, height: 30 },
        },
      ],
    });
    const staged = replica.append([operation]);
    edges.push({ operation, undo: staged.undo![operation.id] });
  }
  const queue = new HistoryTravelQueue(),
    returned = deferred(),
    entered = deferred(),
    requests: string[] = [],
    published: string[][] = [];
  async function undo() {
    const edge = edges.at(-1)!;
    requests.push(edge.operation.id);
    const plan = replica.compensationGroupPlan([edge]);
    for (const changes of plan.phases)
      replica.append([
        createInkOperation({
          actor: "device",
          sequence: replica.actorSequence("device") + 1,
          pageId: "page",
          boardId: "board",
          parents: [...replica.frontier],
          changes,
        }),
      ]);
    if (requests.length === 1) {
      entered.resolve();
      await returned.promise;
    }
    edges.pop();
    published.push(
      replica
        .materialize()
        .strokes.filter((stroke) => !stroke.deleted)
        .map((stroke) => stroke.id),
    );
  }
  const first = queue.enqueue(undo),
    second = queue.enqueue(undo);
  await entered.promise;
  expect(requests).toEqual(["device:2"]);
  expect(edges).toHaveLength(2);
  expect(queue.pending).toBe(true);
  let completed = false;
  const flushed = queue.flush().then(() => {
    completed = true;
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  returned.resolve();
  await Promise.all([first, second, flushed]);
  expect(requests).toEqual(["device:2", "device:1"]);
  expect(published).toEqual([["a"], []]);
  expect(edges).toEqual([]);
  await queue.close();
});

it("preserves an uncertain failure and never starts a later inverse or retries it implicitly", async () => {
  const queue = new HistoryTravelQueue(),
    gate = deferred(),
    error = new Error("actual operation accepted but reply unavailable");
  let started = 0;
  const first = queue.enqueue(async () => {
    started++;
    await gate.promise;
    throw error;
  });
  const later = queue.enqueue(async () => {
    started++;
  });
  const outcomes = Promise.allSettled([first, later]);
  gate.resolve();
  expect((await outcomes).map((value) => value.status)).toEqual([
    "rejected",
    "rejected",
  ]);
  expect(started).toBe(1);
  await expect(queue.flush()).rejects.toBe(error);
  await expect(
    queue.enqueue(async () => {
      started++;
    }),
  ).rejects.toBe(error);
  expect(started).toBe(1);
});

it("reopens after a hidden Activity disconnects the editor that owns the queue", async () => {
  const queue = new HistoryTravelQueue();
  let undone = 0;
  await queue.close();
  await expect(
    queue.enqueue(async () => {
      undone++;
    }),
  ).rejects.toThrow("History source is retiring");
  queue.open();
  await queue.enqueue(async () => {
    undone++;
  });
  expect(undone).toBe(1);
});

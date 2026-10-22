import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../core/store";
import { PortableCubicInputOwner } from "./portable-cubic-worker-model";
import { OwnedSourceSession, createSourceTransport } from "./source-client";
import { appendNewPortableInk } from "./portable-ink-append.mjs";
import { editNode } from "./editing";
import { transformObjects, removeObjects } from "./board-commands";
import { inkCheckpointFromDocument, inkWireConflicts } from "./ink-wire.mjs";
import { InkOperationReplica } from "./ink-operations.mjs";
import { mergePageContent, canCommitPageMerge } from "../core/page-merge-model";

it("hydrates actual new v2 into causal state and keeps source through independent owners/CAS/concurrent edits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "showai-cubic-multiowner-"));
  const owners: OwnedSourceSession[] = [];
  try {
    const store = new FileStore(directory),
      project = await store.createProject({ name: "Actual cubic concurrent" }),
      page = await store.createPage(project.id, { kind: "board" }),
      boardId = page.document.content.attrs!.id;
    const input = new PortableCubicInputOwner();
    input.execute({
      kind: "begin",
      options: {
        strokeId: "new-cubic",
        pageId: page.document.id,
        boardId,
        tool: "pen",
        color: "#111111",
        width: 3,
        pressure: true,
        creationZoom: 1,
        origin: { x: 5, y: 6 },
        name: "Actual input",
      },
      batch: {
        actual: Array.from({ length: 130 }, (_, i) => ({
          id: i + 1,
          x: i * 0.2,
          y: Math.sin(i / 12),
          time: i / 120,
          force: 0.3 + (i % 7) / 10,
        })),
        predicted: [],
      },
    });
    const sealed = input.execute({
        kind: "seal",
        strokeId: "new-cubic",
        batches: [],
      }).sealed!,
      source = sealed.source;
    const created = await store.savePage(
      project.id,
      page.document.id,
      appendNewPortableInk(page.document, boardId, sealed.node, sealed.frame),
      page.hash,
      page.revision,
    );
    expect(created.document.content.attrs!.inkState.format).toBe(
      "showai-ink-state-v1",
    );
    const checkpoint = inkCheckpointFromDocument(created.document, boardId)!,
      replica = new InkOperationReplica({ checkpoint });
    expect(replica.materialize().strokes[0].node.attrs!.ink).toEqual(source);
    const makeOwner = () => {
      const owner = new OwnedSourceSession(
        project.id,
        page.document.id,
        createSourceTransport(async () => {
          throw new Error("Node actual owner has no Native transport");
        }, directory),
      );
      owners.push(owner);
      owner.replace(created.document);
      return owner;
    };
    const a = makeOwner(),
      b = makeOwner(),
      baseline = created.document;
    const color = a.replace(
      editNode(
        a.document!,
        "new-cubic",
        (node) => {
          node.attrs!.color = "#ff0000";
        },
        { normalize: false, attributesOnly: true },
      ),
    );
    const sized = b.replace(
      editNode(
        b.document!,
        "new-cubic",
        (node) => {
          node.attrs!.strokeWidth = 7;
        },
        { normalize: false, attributesOnly: true },
      ),
    );
    const moved = b.replace(
      transformObjects(sized, {
        "new-cubic": { ...sealed.frame, x: 320, y: 150, rotation: 23 },
      }),
    );
    await Promise.all([a.barrier(), b.barrier()]);
    const savedA = await store.savePage(
      project.id,
      page.document.id,
      color,
      created.hash,
      created.revision,
    );
    await expect(
      store.savePage(
        project.id,
        page.document.id,
        moved,
        created.hash,
        created.revision,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const incoming = b.captureExternal(savedA.document, "actual-cas-winner");
    const merged = await b.merge(
      b.captureExternal(baseline, "baseline"),
      moved,
      incoming,
    );
    const current = b.apply(merged.delta)!;
    await merged.release();
    const savedB = await store.savePage(
      project.id,
      page.document.id,
      current,
      savedA.hash,
      savedA.revision,
    );
    const node = savedB.document.content.content!.find(
      (node) => node.attrs!.id === "new-cubic",
    )!;
    expect(node.attrs).toMatchObject({ color: "#ff0000", strokeWidth: 7 });
    expect(savedB.document.layout!["new-cubic"]).toMatchObject({
      x: 320,
      y: 150,
      rotation: 23,
    });
    expect(node.attrs!.ink).toEqual(source);
    const actual = new InkOperationReplica({
      checkpoint: inkCheckpointFromDocument(savedB.document, boardId)!,
    });
    expect(actual.materialize().strokes[0].node.attrs!.ink).toEqual(source);
    expect(actual.materialize().conflicts).toEqual([]);
    const deletion = removeObjects(savedB.document, ["new-cubic"]);
    const foreign = editNode(
      savedB.document,
      "new-cubic",
      (node) => {
        node.attrs!.color = "#00aa00";
      },
      { normalize: false, attributesOnly: true },
    );
    const fork = mergePageContent(savedB.document, deletion, foreign);
    expect(canCommitPageMerge(fork)).toBe(true);
    expect(
      inkWireConflicts(fork.document).every((conflict) => conflict.retained),
    ).toBe(true);
    const erased = await store.savePage(
      project.id,
      page.document.id,
      deletion,
      savedB.hash,
      savedB.revision,
    );
    const restored = await store.savePage(
      project.id,
      page.document.id,
      savedB.document,
      erased.hash,
      erased.revision,
    );
    const cold = await new FileStore(directory).readPage(
      project.id,
      page.document.id,
    );
    expect(cold.document).toEqual(restored.document);
    expect(
      cold.document.content.content!.find(
        (node) => node.attrs!.id === "new-cubic",
      )!.attrs!.ink,
    ).toEqual(source);
    const final = new InkOperationReplica({
      checkpoint: inkCheckpointFromDocument(cold.document, boardId)!,
    });
    expect(final.materialize().strokes[0].node.attrs!.ink).toEqual(source);
    const c = makeOwner(),
      d = makeOwner();
    c.replace(cold.document);
    d.replace(cold.document);
    const newStroke = (id: string, x: number) => {
      const kernel = new PortableCubicInputOwner();
      kernel.execute({
        kind: "begin",
        options: {
          strokeId: id,
          pageId: page.document.id,
          boardId,
          tool: "pen",
          color: "#0000ff",
          width: 3,
          pressure: true,
          creationZoom: 1,
          origin: { x, y: 30 },
          name: "Concurrent new input",
        },
        batch: {
          actual: [
            { id: 1, x: 0, y: 0, time: 0, force: 0.3 },
            { id: 2, x: 20, y: 5, time: 0.01, force: 0.8 },
          ],
          predicted: [],
        },
      });
      return kernel.execute({ kind: "seal", strokeId: id, batches: [] })
        .sealed!;
    };
    const left = newStroke("concurrent-C", 10),
      right = newStroke("concurrent-D", 100);
    const cdraft = c.replace(
        appendNewPortableInk(cold.document, boardId, left.node, left.frame),
      ),
      ddraft = d.replace(
        appendNewPortableInk(cold.document, boardId, right.node, right.frame),
      );
    await Promise.all([c.barrier(), d.barrier()]);
    const savedC = await store.savePage(
      project.id,
      page.document.id,
      cdraft,
      cold.hash,
      cold.revision,
    );
    await expect(
      store.savePage(
        project.id,
        page.document.id,
        ddraft,
        cold.hash,
        cold.revision,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const joined = await d.merge(
      d.captureExternal(cold.document, "actual-base-CD"),
      ddraft,
      d.captureExternal(savedC.document, "actual-C"),
    );
    const joinedBody = d.apply(joined.delta)!;
    await joined.release();
    const savedD = await store.savePage(
      project.id,
      page.document.id,
      joinedBody,
      savedC.hash,
      savedC.revision,
    );
    const visible = savedD.document.content.content!,
      cNode = visible.find((node) => node.attrs!.id === "concurrent-C")!,
      dNode = visible.find((node) => node.attrs!.id === "concurrent-D")!;
    expect(cNode.attrs!.ink).toEqual(left.source);
    expect(dNode.attrs!.ink).toEqual(right.source);
    const cObserved = c.replace(
        c.captureExternal(savedD.document, "final-head"),
      ),
      dObserved = d.replace(d.captureExternal(savedD.document, "final-head"));
    await Promise.all([c.barrier(), d.barrier()]);
    expect(cObserved).toEqual(dObserved);
    const materialized = new InkOperationReplica({
      checkpoint: inkCheckpointFromDocument(savedD.document, boardId)!,
    }).materialize();
    expect(materialized.conflicts).toEqual([]);
    expect(materialized.strokes.map((stroke) => stroke.node.attrs!.id)).toEqual(
      visible.filter((node) => node.attrs?.ink).map((node) => node.attrs!.id),
    );
  } finally {
    await Promise.all(owners.map((owner) => owner.dispose()));
    await rm(directory, { recursive: true, force: true });
  }
});

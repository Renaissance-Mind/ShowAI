import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composerDraftKey,
  createDraftStore,
  draftStorageKey,
  type DraftStorage,
} from "./draft-store";
import { createInFlight } from "./in-flight";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage: DraftStorage & { values: Map<string, string> } = {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  return storage;
}

afterEach(() => vi.useRealTimers());

describe("assistant draft store", () => {
  it("shares one draft between the side panel and the floating box", () => {
    const storage = memoryStorage();
    const store = createDraftStore(() => storage);
    const seen: string[] = [];
    const stop = store.subscribe(() =>
      seen.push(store.getSnapshot().drafts["p/composer/x"]?.text ?? ""),
    );
    store.update("p/composer/x", { text: "make it shorter" });
    expect(store.draft("p/composer/x").text).toBe("make it shorter");
    expect(seen).toEqual(["make it shorter"]);
    stop();
  });

  it("writes drafts after the delay and restores them in a new window", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const store = createDraftStore(() => storage, { delay: 150 });
    store.update("p/new", { text: "half typed" });
    expect(storage.values.has(draftStorageKey)).toBe(false);
    vi.advanceTimersByTime(150);
    const reopened = createDraftStore(() => storage);
    expect(reopened.draft("p/new").text).toBe("half typed");
  });

  it("clears a sent draft only while it is still what was sent", () => {
    const store = createDraftStore(() => memoryStorage());
    store.update("k", { text: "first" });
    const sentAt = store.draft("k").updatedAt;
    store.update("k", { text: "first, then more" });
    store.clear("k", "first", sentAt);
    expect(store.draft("k").text).toBe("first, then more");
    const current = store.draft("k");
    store.clear("k", current.text, current.updatedAt);
    expect(store.has("k")).toBe(false);
  });

  it("keeps the newest drafts within the limit", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const store = createDraftStore(() => storage, { limit: 2 });
    for (const [index, key] of ["a", "b", "c"].entries()) {
      vi.setSystemTime(1000 + index);
      store.update(key, { text: key });
    }
    expect(store.persist()).toBeUndefined();
    expect(Object.keys(JSON.parse(storage.values.get(draftStorageKey)!))).toEqual(
      ["c", "b"],
    );
    expect(store.has("a")).toBe(false);
  });

  it("reports a failed write and recovers on the next one", () => {
    const storage = memoryStorage();
    let full = true;
    const store = createDraftStore(() => ({
      getItem: storage.getItem,
      setItem: (key, value) => {
        if (full) throw new Error("QuotaExceededError");
        storage.setItem(key, value);
      },
    }));
    store.update("k", { text: "kept in memory" });
    expect(store.persist()).toContain("QuotaExceededError");
    expect(store.getSnapshot().error).toContain("QuotaExceededError");
    full = false;
    expect(store.persist()).toBeUndefined();
    expect(store.getSnapshot().error).toBe("");
  });

  it("drops unreadable entries from an older save", () => {
    const store = createDraftStore(() =>
      memoryStorage({
        [draftStorageKey]: JSON.stringify({
          good: { text: "ok", updatedAt: 1 },
          bad: { text: 3 },
        }),
      }),
    );
    expect(store.has("good")).toBe(true);
    expect(store.has("bad")).toBe(false);
  });

  it("keys the floating box by project, page and target", () => {
    const anchor = { left: 0, top: 0, bottom: 0 };
    const block = composerDraftKey("p", "page", {
      kind: "blocks",
      blockIds: ["b1"],
      anchor,
    });
    expect(
      composerDraftKey("p", "page", {
        kind: "blocks",
        blockIds: ["b1"],
        anchor: { left: 40, top: 80, bottom: 90 },
      }),
    ).toBe(block);
    expect(
      composerDraftKey("p", "page", { kind: "blocks", blockIds: ["b2"], anchor }),
    ).not.toBe(block);
    expect(
      composerDraftKey("p", "other", { kind: "blocks", blockIds: ["b1"], anchor }),
    ).not.toBe(block);
    expect(
      composerDraftKey("p", "page", {
        kind: "text",
        blockIds: ["b1"],
        text: "one sentence",
        anchor,
      }),
    ).not.toBe(
      composerDraftKey("p", "page", {
        kind: "text",
        blockIds: ["b1"],
        text: "another sentence",
        anchor,
      }),
    );
    // The panel's own drafts use projectId/threadId and never collide.
    expect(composerDraftKey("p", "page", { kind: "page" })).not.toBe("p/new");
  });
});

describe("assistant in-flight guard", () => {
  it("runs a double-clicked action once and reports it pending", async () => {
    const changes: string[][] = [];
    const inFlight = createInFlight((keys) => changes.push(keys));
    let finish!: () => void;
    let calls = 0;
    const work = () => {
      calls++;
      return new Promise<void>((resolve) => (finish = resolve));
    };
    const first = inFlight.run("retry:c1", work);
    const second = inFlight.run("retry:c1", work);
    expect(await second).toBe(false);
    expect(calls).toBe(1);
    expect(inFlight.has("retry:c1")).toBe(true);
    finish();
    expect(await first).toBe(true);
    expect(inFlight.has("retry:c1")).toBe(false);
    expect(changes).toEqual([["retry:c1"], []]);
  });

  it("frees the key after a failure so the action can be tried again", async () => {
    const inFlight = createInFlight(() => {});
    await expect(
      inFlight.run("undo:t1", () => Promise.reject(new Error("changed"))),
    ).rejects.toThrow("changed");
    expect(inFlight.has("undo:t1")).toBe(false);
  });

  it("holds a stop request until it is released", async () => {
    const inFlight = createInFlight(() => {});
    await inFlight.run("cancel:t1", () => Promise.resolve(), true);
    expect(inFlight.has("cancel:t1")).toBe(true);
    expect(await inFlight.run("cancel:t1", () => Promise.resolve())).toBe(false);
    inFlight.release("cancel:t1");
    expect(inFlight.has("cancel:t1")).toBe(false);
  });

  it("shares keys with sending, so a send and its retry cannot overlap", () => {
    const inFlight = createInFlight(() => {});
    expect(inFlight.claim("p/new")).toBe(true);
    expect(inFlight.claim("p/new")).toBe(false);
    inFlight.release("p/new");
    expect(inFlight.claim("p/new")).toBe(true);
  });
});

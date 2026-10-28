import { describe, expect, it } from "vitest";
import { MAX_READER_VALUE_BYTES, ReaderStateStore } from "./reader-state";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

describe("reader state store", () => {
  it("keeps slots per page and block across store instances", () => {
    const storage = memoryStorage();
    const store = new ReaderStateStore(storage, 10_000);
    store.write("page-a", "block-1", "tab", 2);
    store.write("page-a", "block-2", "open", true);
    store.write("page-b", "block-1", "tab", 5);
    expect(storage.items.size).toBe(0);
    store.flush();
    const next = new ReaderStateStore(storage, 10_000);
    expect(next.read("page-a", "block-1", "tab")).toBe(2);
    expect(next.read("page-a", "block-2", "open")).toBe(true);
    expect(next.read("page-b", "block-1", "tab")).toBe(5);
    expect(next.read("page-b", "block-2", "open")).toBeUndefined();
  });

  it("removes a page whose last slot is cleared", () => {
    const storage = memoryStorage();
    const store = new ReaderStateStore(storage, 10_000);
    store.write("page-a", "block-1", "tab", 2);
    store.flush();
    store.write("page-a", "block-1", "tab", undefined);
    store.flush();
    expect(storage.items.get("showai.reader-state.v1:page-a")).toBeUndefined();
    expect(JSON.parse(storage.items.get("showai.reader-state.v1")!)).toEqual(
      {},
    );
  });

  it("refuses oversized values and ignores damaged pages", () => {
    const storage = memoryStorage();
    storage.setItem("showai.reader-state.v1:page-a", "{broken");
    const store = new ReaderStateStore(storage, 10_000);
    expect(store.read("page-a", "block-1", "tab")).toBeUndefined();
    store.write("page-a", "block-1", "big", "x".repeat(MAX_READER_VALUE_BYTES));
    expect(store.read("page-a", "block-1", "big")).toBeUndefined();
  });

  it("tells other instances of the same slot after the current task", async () => {
    const store = new ReaderStateStore(memoryStorage(), 10_000);
    const seen: unknown[] = [];
    const stop = store.subscribe("page-a", "block-1", "tab", (value) =>
      seen.push(value),
    );
    store.write("page-a", "block-1", "tab", 1);
    store.write("page-a", "block-1", "tab", 1);
    store.write("page-a", "block-2", "tab", 3);
    expect(seen).toEqual([]);
    await Promise.resolve();
    stop();
    store.write("page-a", "block-1", "tab", 4);
    await Promise.resolve();
    expect(seen).toEqual([1]);
  });

  it("keeps the most recently read pages", () => {
    const storage = memoryStorage();
    const store = new ReaderStateStore(storage, 10_000);
    for (let index = 0; index < 405; index++) {
      store.write(`page-${index}`, "block", "tab", index);
      store.flush();
    }
    const index = JSON.parse(storage.items.get("showai.reader-state.v1")!);
    expect(Object.keys(index)).toHaveLength(400);
    expect(storage.items.has("showai.reader-state.v1:page-0")).toBe(false);
    expect(storage.items.has("showai.reader-state.v1:page-404")).toBe(true);
  });
});

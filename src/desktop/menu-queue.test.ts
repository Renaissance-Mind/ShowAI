import { expect, test } from "vitest";
import { MenuCommandQueue } from "./menu-queue";

test("menu commands wait for a starting window and arrive once, in order", () => {
  const delivered: [string, string][] = [];
  const queue = new MenuCommandQueue<{ id: string }, string>((target, command) =>
    delivered.push([target.id, command]),
  );
  const opening = { id: "new" },
    open = { id: "open" };
  queue.send(opening, "about");
  queue.send(opening, "settings");
  expect(delivered).toEqual([]);
  queue.markReady(open);
  queue.send(open, "newPage");
  queue.markReady(opening);
  expect(delivered).toEqual([
    ["open", "newPage"],
    ["new", "about"],
    ["new", "settings"],
  ]);
  // A reload holds commands again until the new document listens.
  queue.reset(opening);
  queue.send(opening, "import");
  expect(delivered).toHaveLength(3);
  queue.markReady(opening);
  queue.markReady(opening);
  expect(delivered.at(-1)).toEqual(["new", "import"]);
  expect(delivered).toHaveLength(4);
});

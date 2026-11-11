import { describe, expect, test } from "vitest";
import { PresenceController, type PresenceState } from "./presence";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

function controller(open: boolean) {
  const reports: PresenceState[] = [];
  const presence = new PresenceController(open, (state) => reports.push(state));
  return { presence, reports };
}

describe("presence controller", () => {
  test("an element open from the start appears without an entrance", () => {
    const { presence, reports } = controller(true);
    expect(presence.state).toBe("shown");
    expect(reports).toEqual([]);
  });

  test("opening plays the entrance and settles shown", async () => {
    const { presence, reports } = controller(false);
    presence.show(true);
    expect(presence.state).toBe("entering");
    const entrance = deferred();
    presence.entered(entrance.promise);
    entrance.resolve();
    await entrance.promise;
    await Promise.resolve();
    expect(reports).toEqual(["entering", "shown"]);
  });

  test("closing keeps the element until its exit ends", async () => {
    const { presence, reports } = controller(true);
    presence.hide(true);
    expect(presence.state).toBe("exiting");
    const exit = deferred();
    presence.settle(exit.promise);
    await Promise.resolve();
    expect(presence.state).toBe("exiting");
    exit.resolve();
    await exit.promise;
    await Promise.resolve();
    expect(reports).toEqual(["exiting", "hidden"]);
  });

  test("reopening during the exit cancels the pending unmount", async () => {
    const { presence, reports } = controller(true);
    presence.hide(true);
    const exit = deferred();
    presence.settle(exit.promise);
    presence.show(true);
    exit.resolve();
    await exit.promise;
    await Promise.resolve();
    expect(presence.state).toBe("entering");
    expect(reports).toEqual(["exiting", "entering"]);
  });

  test("a stale entrance does not mark a closing element shown", async () => {
    const { presence } = controller(false);
    presence.show(true);
    const entrance = deferred();
    presence.entered(entrance.promise);
    presence.hide(true);
    entrance.resolve();
    await entrance.promise;
    await Promise.resolve();
    expect(presence.state).toBe("exiting");
  });

  test("without motion it mounts and unmounts at once", () => {
    const { presence, reports } = controller(false);
    presence.show(false);
    presence.hide(false);
    expect(reports).toEqual(["shown", "hidden"]);
  });

  test("open, close, open in quick succession ends open with one exit", async () => {
    const { presence, reports } = controller(false);
    presence.show(true);
    presence.hide(true);
    const exit = deferred();
    presence.settle(exit.promise);
    presence.show(true);
    exit.resolve();
    await exit.promise;
    await Promise.resolve();
    expect(presence.state).toBe("entering");
    expect(reports).toEqual(["entering", "exiting", "entering"]);
  });
});

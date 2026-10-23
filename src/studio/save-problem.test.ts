import { expect, it } from "vitest";
import {
  describeSaveFailure,
  largestBlock,
  saveSafety,
} from "./save-problem";

const page = (failure: { message: string } & Record<string, unknown>) => ({
  error: failure.message,
  failure,
  dirty: true,
  draftDurable: false,
  title: "周报",
});

it("derives the safety line from the session's draft state", () => {
  expect(saveSafety({ dirty: false, draftDurable: false })).toBe("saved");
  expect(saveSafety({ dirty: true, draftDurable: true })).toBe("draftKept");
  expect(saveSafety({ dirty: true, draftDurable: false })).toBe("windowOnly");
});

it("offers only follow-ups that do not fail for the same reason", () => {
  const full = describeSaveFailure(
    page({
      code: "ERROR",
      errno: "ENOSPC",
      path: "/library/.showai/local/drafts/a.tmp",
      message: "ENOSPC: no space left on device",
    }),
  );
  expect(full.kind).toBe("diskFull");
  expect(full.safety).toBe("windowOnly");
  expect(full.offers).toEqual(["retry", "librarySpace"]);
  expect(full.problem.title).toContain("周报");
  expect(full.problem.title).not.toContain("ENOSPC");
  expect(full.problem.details).toContain("ENOSPC: no space left on device");

  const denied = describeSaveFailure({
    ...page({
      errno: "EACCES",
      path: "/library/projects/p/pages",
      message: "EACCES: permission denied",
    }),
    draftDurable: true,
  });
  expect(denied.kind).toBe("permission");
  expect(denied.safety).toBe("draftKept");
  expect(denied.offers).toEqual(["reveal", "retry"]);
  expect(denied.path).toBe("/library/projects/p/pages");

  const large = describeSaveFailure(
    page({
      code: "CAPACITY_EXCEEDED",
      kind: "page structure",
      actualBytes: 20,
      limitBytes: 10,
      message: "page structure is 20 bytes; limit is 10",
    }),
  );
  expect(large.kind).toBe("capacity");
  expect(large.offers).toEqual(["locateLargest", "retry"]);

  const other = describeSaveFailure(page({ message: "Unexpected failure" }));
  expect(other.kind).toBe("other");
  expect(other.offers).toEqual(["retry", "keepCopy"]);
});

it("locates the block holding most of the page's bytes", () => {
  const big = "x".repeat(5000);
  expect(
    largestBlock({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "small" },
          content: [{ type: "text", text: "hi" }],
        },
        {
          type: "surface",
          attrs: { id: "surface" },
          content: [
            { type: "chart", attrs: { id: "chart", data: big } },
            { type: "paragraph", attrs: { id: "note" } },
          ],
        },
      ],
    }),
  ).toBe("chart");
  expect(largestBlock({ type: "doc" })).toBeNull();
});

import { describe, expect, it } from "vitest";
import { closeBlockers, closeReporter, describeBlocker } from "./close-report";
import type { CloseResult } from "./bridge";

const entry = (
  source: "pages" | "datasets" | "assistant" | "sidebar" | "workbench",
  listener: () => Promise<CloseResult>,
) => ({ source, listener });

describe("close reports", () => {
  it("allows closing only when every listener allows it", async () => {
    const report = closeReporter(1000);
    expect(
      await report([
        entry("pages", async () => true),
        entry("datasets", async () => ({ allow: true })),
      ]),
    ).toEqual({ allow: true, pages: [], blockers: [], reason: "" });
  });

  it("names each refusing part with a stable code", async () => {
    const report = closeReporter(1000);
    const result = await report([
      entry("sidebar", async () => false),
      entry("pages", async () => ({
        allow: false,
        pages: [
          {
            projectId: "p",
            pageId: "a",
            title: "Plan",
            reason: "Couldn't save the local draft: EACCES",
          },
        ],
      })),
      entry("assistant", async () => {
        throw new Error("QuotaExceededError");
      }),
      entry("datasets", async () => ({
        allow: false,
        blockers: [
          {
            code: "DATASET_NOT_RETAINED",
            source: "datasets",
            datasetId: "d",
            title: "OKR",
            message: "draft failed",
          },
        ],
      })),
    ]);
    expect(result.allow).toBe(false);
    expect(result.pages.map((page) => page.pageId)).toEqual(["a"]);
    expect(
      result.blockers.map((blocker) => [blocker.source, blocker.code]),
    ).toEqual([
      ["sidebar", "LISTENER_REFUSED"],
      ["pages", "PAGE_NOT_RETAINED"],
      ["assistant", "LISTENER_FAILED"],
      ["datasets", "DATASET_NOT_RETAINED"],
    ]);
    expect(result.blockers[1]).toMatchObject({
      pageId: "a",
      title: "Plan",
      message: "Couldn't save the local draft: EACCES",
    });
    expect(result.blockers[2].message).toBe("QuotaExceededError");
    expect(result.reason).toContain('page "Plan": [PAGE_NOT_RETAINED]');
  });

  it("reports a slow listener and continues the same call on the next request", async () => {
    const report = closeReporter(30);
    let calls = 0;
    let release!: () => void;
    const slow = entry("sidebar", () => {
      calls++;
      return new Promise<CloseResult>((done) => {
        release = () => done(true);
      });
    });
    const first = await report([slow]);
    expect(first.allow).toBe(false);
    expect(first.blockers).toEqual([
      { code: "LISTENER_TIMEOUT", source: "sidebar", seconds: 0 },
    ]);
    const second = report([slow]);
    release();
    expect((await second).allow).toBe(true);
    expect(calls).toBe(1);
    // A finished call is not reused: the next request asks again.
    const third = report([slow]);
    await new Promise((done) => setTimeout(done, 0));
    release();
    expect((await third).allow).toBe(true);
    expect(calls).toBe(2);
  });

  it("keeps only known codes and bounded fields from a renderer", () => {
    expect(
      closeBlockers([
        {
          code: "PAGE_NOT_RETAINED",
          source: "pages",
          pageId: "a",
          title: "x".repeat(500),
          seconds: 3.6,
          extra: "dropped",
        },
        { code: "SOMETHING_ELSE", source: "pages" },
        { code: "LISTENER_REFUSED", source: "unknown" },
        "not an object",
      ]),
    ).toEqual([
      {
        code: "PAGE_NOT_RETAINED",
        source: "pages",
        pageId: "a",
        title: "x".repeat(200),
        seconds: 4,
      },
      { code: "LISTENER_REFUSED", source: "workbench" },
    ]);
    expect(closeBlockers("nope")).toEqual([]);
    expect(
      describeBlocker({ code: "NO_REPLY", source: "window", seconds: 20 }),
    ).toBe("window: [NO_REPLY] the window did not answer within 20 s");
  });
});

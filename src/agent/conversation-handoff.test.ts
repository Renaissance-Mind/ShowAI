import { expect, test } from "vitest";
import { conversationHandoff } from "./presentation-tools";

test("hosts that read delivery files get no handoff", () => {
  expect(
    conversationHandoff("<div></div>", undefined, "codex-visualize", "page_present", true),
  ).toBeUndefined();
});

test("a small fragment is passed on unchanged", () => {
  expect(
    conversationHandoff("<div></div>", undefined, "model-html", "page_present", true),
  ).toMatchObject({ mode: "compact", fragment: "<div></div>" });
});

test("without a CDN reader the conversation view is unavailable", () => {
  expect(
    conversationHandoff(undefined, undefined, "model-html", "page_present", false),
  ).toMatchObject({ mode: "unavailable" });
});

test("a reader without a fragment means the page data is over the budget", () => {
  // Embedded images can push the CDN fragment past the chat budget; the
  // reader is still there, so the next step is a smaller selection.
  const handoff = conversationHandoff(
    undefined,
    undefined,
    "model-html",
    "page_present",
    true,
  );
  expect(handoff).toMatchObject({ mode: "too-large" });
  expect(handoff).not.toHaveProperty("bytes");
  expect(handoff?.next).toContain("blockIds");
  expect(handoff?.next).not.toContain("no CDN reader");
});

test("an oversized fragment reports its size and the selected blocks", () => {
  const handoff = conversationHandoff(
    "x".repeat(40 * 1024),
    ["a"],
    "model-html",
    "page_present",
    true,
  );
  expect(handoff).toMatchObject({ mode: "too-large", bytes: 40 * 1024 });
  expect(handoff?.next).toContain("fewer blockIds");
});

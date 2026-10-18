import { expect, test } from "vitest";
import {
  registerReferencePicker,
  referenceAvailable,
  subscribeReferenceAvailability,
} from "./reference-availability";

test("reference availability follows mounted pickers and stays scoped to the page", () => {
  const snapshots: boolean[] = [];
  const unsubscribe = subscribeReferenceAvailability(() =>
    snapshots.push(referenceAvailable("page-a")),
  );
  expect(referenceAvailable(null)).toBe(false);
  expect(referenceAvailable("page-a")).toBe(false);
  const first = registerReferencePicker("page-a");
  const nested = registerReferencePicker("page-a");
  const other = registerReferencePicker("page-b");
  first();
  expect(referenceAvailable("page-a")).toBe(true);
  nested();
  expect(referenceAvailable("page-a")).toBe(false);
  expect(referenceAvailable("page-b")).toBe(true);
  other();
  unsubscribe();
  expect(snapshots).toEqual([true, true, true, true, false, false]);
});

test("a picker can reappear after a retained page is hidden or a board is unlocked", () => {
  const hide = registerReferencePicker("retained");
  hide();
  expect(referenceAvailable("retained")).toBe(false);
  const hideAgain = registerReferencePicker("retained");
  expect(referenceAvailable("retained")).toBe(true);
  hideAgain();
  expect(referenceAvailable("retained")).toBe(false);
});

import { expect, test } from "vitest";
import { PairingCodes, PAIRING_LIFETIME } from "./pairing";
import { pairingDisplay } from "./client-setup";

test("pairing is single-use and status never exposes the credential", () => {
  const codes = new PairingCodes();
  const receipt = codes.issue(1000);
  expect(pairingDisplay(receipt, codes.status(1000), 1000)).toBe("ready");
  expect(codes.consume("wrong", 1001)).toBe(false);
  expect(codes.consume(receipt.code, 1002)).toBe(true);
  expect(codes.consume(receipt.code, 1003)).toBe(false);
  expect(pairingDisplay(receipt, codes.status(1003), 1003)).toBe("used");
  expect(Object.keys(codes.status(1003)!)).toEqual([
    "id",
    "expiresAt",
    "state",
  ]);
  expect(JSON.stringify(codes.status(1003))).not.toContain(receipt.code);
});
test("regeneration replaces copies in other windows, even in the same millisecond", () => {
  const codes = new PairingCodes();
  const first = codes.issue(1000),
    second = codes.issue(1000);
  expect(pairingDisplay(first, codes.status(1000), 1000)).toBe("replaced");
  expect(pairingDisplay(second, codes.status(1000), 1000)).toBe("ready");
  expect(codes.consume(first.code, 1001)).toBe(false);
  expect(codes.consume(second.code, 1001)).toBe(true);
});
test("expiry prevents both authorization and copying at the deadline", () => {
  const codes = new PairingCodes();
  const receipt = codes.issue(1000);
  const deadline = 1000 + PAIRING_LIFETIME;
  expect(
    pairingDisplay(receipt, codes.status(deadline - 1), deadline - 1),
  ).toBe("ready");
  expect(pairingDisplay(receipt, codes.status(deadline - 1), deadline)).toBe(
    "expired",
  );
  expect(codes.consume(receipt.code, deadline)).toBe(false);
  expect(codes.status(deadline)?.state).toBe("expired");
  codes.clear();
  expect(codes.status()).toBeUndefined();
  expect(codes.consume(receipt.code, deadline)).toBe(false);
});

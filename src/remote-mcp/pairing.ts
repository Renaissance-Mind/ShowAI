import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { PairingStatus } from "./types";

export const PAIRING_LIFETIME = 10 * 60_000;
/** Keep only a digest; status lets every App window retire stale copies of a code. */
export class PairingCodes {
  private current?: {
    id: string;
    hash: Buffer;
    expires: number;
    used: boolean;
  };
  issue(now = Date.now()) {
    const code = randomBytes(18).toString("base64url");
    this.current = {
      id: randomUUID(),
      hash: createHash("sha256").update(code).digest(),
      expires: now + PAIRING_LIFETIME,
      used: false,
    };
    return {
      code,
      id: this.current.id,
      expiresAt: new Date(this.current.expires).toISOString(),
    };
  }
  consume(code: string, now = Date.now()) {
    if (!this.current || this.current.used || now >= this.current.expires)
      return false;
    if (
      !timingSafeEqual(
        createHash("sha256").update(code.trim()).digest(),
        this.current.hash,
      )
    )
      return false;
    this.current.used = true;
    return true;
  }
  status(now = Date.now()): PairingStatus | undefined {
    if (!this.current) return undefined;
    return {
      id: this.current.id,
      expiresAt: new Date(this.current.expires).toISOString(),
      state: this.current.used
        ? "used"
        : now >= this.current.expires
          ? "expired"
          : "ready",
    };
  }
  clear() {
    this.current = undefined;
  }
}

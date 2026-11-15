import type { RedactOptions } from "../core/redact";

let current: RedactOptions = {};

export function configureProblemRedaction(options: RedactOptions) {
  current = { ...options };
}

export function problemRedaction(): RedactOptions {
  return current;
}

import { createHash } from "node:crypto";

export function redactTrace(value: unknown): unknown {
  const large = (source: string) => ({
    omitted: true,
    bytes: Buffer.byteLength(source),
    sha256: createHash("sha256").update(source).digest("hex"),
  });
  if (typeof value === "string" && Buffer.byteLength(value) > 4096)
    return large(value);
  if (Array.isArray(value))
    return value.length > 64
      ? large(JSON.stringify(value))
      : value.map(redactTrace);
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > 64) return large(JSON.stringify(value));
    return Object.fromEntries(
      entries.map(([key, item]) => [
        key,
        /token|secret|password|authorization|credential/i.test(key)
          ? "[redacted]"
          : redactTrace(item),
      ]),
    );
  }
  return value;
}

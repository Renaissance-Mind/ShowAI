import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

async function currentDigest(path: string): Promise<string | null> {
  try {
    return digest(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export class OwnWrites {
  private expected = new Map<
    string,
    { origin: string; digest: string; expires: number }
  >();
  constructor(private readonly ttlMs = 10_000) {}

  async record(origin: string, path: string): Promise<void> {
    const value = await currentDigest(path);
    if (value)
      this.expected.set(path, {
        origin,
        digest: value,
        expires: Date.now() + this.ttlMs,
      });
  }

  async echoes(paths: Iterable<string>): Promise<Map<string, Set<string>>> {
    const now = Date.now();
    for (const [path, entry] of this.expected)
      if (entry.expires <= now) this.expected.delete(path);
    const result = new Map<string, Set<string>>();
    for (const path of paths) {
      const entry = this.expected.get(path);
      if (!entry) continue;
      this.expected.delete(path);
      if ((await currentDigest(path)) !== entry.digest) continue;
      let own = result.get(entry.origin);
      if (!own) result.set(entry.origin, (own = new Set()));
      own.add(path);
    }
    return result;
  }

  clear(): void {
    this.expected.clear();
  }
}

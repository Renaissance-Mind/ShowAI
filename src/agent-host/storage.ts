import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicRename } from "../core/atomic-rename";

export async function readOptional<T>(path: string): Promise<T | undefined> {
  const data = await readFile(path, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  return data === undefined ? undefined : (JSON.parse(data) as T);
}
export async function writeProtected(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  await atomicRename(temporary, path);
  await chmod(path, 0o600);
}

/** Credentials managed by a hosted vault are resolved there, never refreshed locally. */
export interface HostedCredentialBroker {
  accessToken(
    connectionId: string,
    forceRefresh?: boolean,
  ): Promise<{ token: string; expiresAt: number }>;
  disconnect(connectionId: string): Promise<void>;
}

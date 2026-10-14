import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSyncServer } from "../server/node";
import {
  hash,
  snapshotRevision,
  syncProtocol,
  type ProjectSnapshot,
} from "./protocol";
import {
  applySnapshotDelta,
  snapshotDelta,
  snapshotDeltaCapability,
} from "./delta";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const change = (operationId: string, projectId: string) => ({
  at: new Date().toISOString(),
  actor: { kind: "human" as const },
  channel: "cli" as const,
  operationId,
  paths: [`projects/${projectId}/project.json`],
});

test("changes rebuild the exact snapshot and reject a removal of an absent path", () => {
  const base: ProjectSnapshot = {
    format: syncProtocol,
    projectId: "p",
    parents: [],
    files: { "projects/p/a": "1".repeat(64), "projects/p/b": "2".repeat(64) },
    change: change("base", "p"),
  };
  const next: ProjectSnapshot = {
    ...base,
    parents: ["9".repeat(64)],
    files: {
      "projects/p/a": "3".repeat(64),
      "projects/p/c": "4".repeat(64),
      __proto__: "5".repeat(64),
    } as Record<string, string>,
    change: change("next", "p"),
  };
  Object.defineProperty(next.files, "__proto__", {
    value: "5".repeat(64),
    enumerable: true,
  });
  const delta = snapshotDelta(base, next);
  expect(delta.remove).toEqual(["projects/p/b"]);
  const rebuilt = applySnapshotDelta(base, delta, "p");
  expect(Object.hasOwn(rebuilt.files, "__proto__")).toBe(true);
  expect(rebuilt.files).toEqual(next.files);
  expect(() =>
    applySnapshotDelta(base, { ...delta, remove: ["projects/p/zz"] }, "p"),
  ).toThrow("Invalid project snapshot changes.");
});

test("the server publishes changes against its current head and refuses a wrong result", async () => {
  const home = await mkdtemp(join(tmpdir(), "showai-delta-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const server = await startSyncServer({
    home,
    port: 0,
    registrationMode: "open",
  });
  cleanup.push(() => server.close());
  const info = await (await fetch(server.url + "/api/info")).json();
  expect(info.capabilities).toContain(snapshotDeltaCapability);
  const account = await (
    await fetch(server.url + "/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "owner", password: "delta-password-2026" }),
    })
  ).json();
  const headers = {
    authorization: `Bearer ${account.token}`,
    "content-type": "application/json",
  };
  const id = crypto.randomUUID();
  await fetch(server.url + "/api/projects", {
    method: "POST",
    headers,
    body: JSON.stringify({ id, name: "Delta" }),
  });
  const put = async (bytes: Buffer) => {
    const digest = await hash(bytes);
    const response = await fetch(
      server.url + `/api/projects/${id}/objects/${digest}`,
      {
        method: "PUT",
        headers: { authorization: headers.authorization },
        body: Uint8Array.from(bytes),
      },
    );
    expect(response.status).toBe(200);
    return digest;
  };
  const metadata = await put(
    Buffer.from(JSON.stringify({ id, name: "Delta" })),
  );
  const first: ProjectSnapshot = {
    format: syncProtocol,
    projectId: id,
    parents: [],
    files: { [`projects/${id}/project.json`]: metadata },
    change: change("first", id),
  };
  const post = async (body: unknown) => {
    const response = await fetch(server.url + `/api/projects/${id}/snapshot`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  };
  const published = await post({ snapshot: first, expected: null });
  expect(published.status).toBe(200);
  const head = published.value.head as string;
  const extra = await put(Buffer.from("added through a change set"));
  const second: ProjectSnapshot = {
    ...first,
    parents: [head],
    files: { ...first.files, [`projects/${id}/data/extra.txt`]: extra },
    change: change("second", id),
  };
  const revision = await snapshotRevision(second);
  const delta = snapshotDelta(first, second);
  expect(
    (await post({ expected: head, revision: "0".repeat(64), delta })).value
      .error.code,
  ).toBe("DELTA_MISMATCH");
  expect(
    (await post({ expected: "1".repeat(64), revision, delta })).value.error
      .code,
  ).toBe("CONFLICT");
  const accepted = await post({ expected: head, revision, delta });
  expect(accepted.status).toBe(200);
  expect(accepted.value.head).toBe(revision);
  const current = await (
    await fetch(server.url + `/api/projects/${id}/snapshot`, {
      headers: { authorization: headers.authorization },
    })
  ).json();
  expect(current.snapshot).toEqual(second);
});

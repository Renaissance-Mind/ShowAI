import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSyncServer, SQLiteMetadata } from "./node";
import { hash } from "../sync/protocol";
import { resumableUpload } from "../sync/resumable-upload";
import { uploadPartBytes } from "./uploads";
import type { StoragePolicy } from "./quotas";

test("a device expiring during a real streamed upload cannot publish a readable object", async () => {
  const f = await fixture();
  const editor = await f.register("expiring-editor");
  const invite = await f.request(
    "/api/projects/project/invites",
    "POST",
    { role: "editor" },
    f.owner.token,
  );
  expect(
    (
      await f.request(
        "/api/invites/accept",
        "POST",
        { invite: invite.value.invite },
        editor.token,
      )
    ).status,
  ).toBe(200);
  const bytes = Buffer.from("expiry-boundary"),
    digest = await hash(bytes);
  let finish!: () => void;
  let finished = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 1));
      finish = () => {
        if (finished) return;
        finished = true;
        controller.enqueue(bytes.subarray(1));
        controller.close();
      };
    },
  });
  const pending = fetch(f.url() + `/api/projects/project/objects/${digest}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${editor.token}`,
      "content-length": String(bytes.length),
    },
    body,
    duplex: "half",
  } as RequestInit);
  const db = new SQLiteMetadata(join(f.home, "metadata.sqlite"));
  try {
    const deadline = Date.now() + 5000;
    while (
      !(
        await db.all(
          "SELECT 1 FROM storage_reservations WHERE project_id=? AND digest=?",
          ["project", digest],
        )
      ).length
    ) {
      if (Date.now() > deadline)
        throw new Error("The real upload was not admitted.");
      await new Promise((done) => setTimeout(done, 10));
    }
    await db.run("UPDATE sessions SET expires_at=? WHERE digest=?", [
      new Date(Date.now() + 25).toISOString(),
      await hash(editor.token),
    ]);
    await new Promise((done) => setTimeout(done, 60));
    finish();
    const uploaded = await pending;
    expect(uploaded.status).toBe(401);
    await uploaded.arrayBuffer();
    const visible = await fetch(
      f.url() + `/api/projects/project/objects/${digest}`,
      { headers: { authorization: `Bearer ${f.owner.token}` } },
    );
    expect(visible.status).toBe(404);
    await visible.arrayBuffer();
    expect(
      (
        await db.all(
          "SELECT 1 FROM storage_reservations WHERE project_id=? AND digest=?",
          ["project", digest],
        )
      ).length,
    ).toBe(1);
  } finally {
    finish();
    await pending.catch(() => undefined);
    db.close();
  }
});
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanups.splice(0).reverse()) await action();
});
async function fixture(policy: Partial<StoragePolicy> = {}) {
  const home = await mkdtemp(join(tmpdir(), "showai-upload-"));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  const options = {
    home,
    port: 0,
    registrationKey: "upload-key",
    registrationLimit: 120,
    storagePolicy: policy,
  };
  let server = await startSyncServer(options);
  cleanups.push(() => server.close());
  const request = async (
    path: string,
    method = "GET",
    data?: unknown,
    token?: string,
  ) => {
    const response = await fetch(server.url + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(data ? { "content-type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return { status: response.status, value: await response.json() };
  };
  const register = async (name: string) => {
    const result = await request("/api/auth/register", "POST", {
      name,
      password: "upload-password-2026",
      registrationKey: "upload-key",
    });
    expect(result.status).toBe(201);
    return result.value;
  };
  const owner = await register("owner");
  const project = "project";
  expect(
    (
      await request(
        "/api/projects",
        "POST",
        { id: project, name: "Upload contract" },
        owner.token,
      )
    ).status,
  ).toBe(201);
  const put = async (path: string, bytes: Uint8Array, token = owner.token) =>
    fetch(server.url + path, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
      body: Uint8Array.from(bytes),
    });
  const restart = async () => {
    await server.close();
    server = await startSyncServer(options);
  };
  return {
    home,
    options,
    request,
    register,
    owner,
    project,
    put,
    restart,
    url: () => server.url,
  };
}

test("concurrent storage reservations prevent overcommit and duplicate objects do not consume capacity twice", async () => {
  const f = await fixture({
    projectBytes: 100,
    accountBytes: 100,
    serviceBytes: 1000,
    accountDailyBytes: 1000,
    serviceDailyBytes: 10000,
  });
  const blocks = [Buffer.alloc(60, 1), Buffer.alloc(60, 2)];
  const responses = await Promise.all(
    blocks.map(async (bytes) =>
      f.put(`/api/projects/project/objects/${await hash(bytes)}`, bytes),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([
    200, 507,
  ]);
  const usage = (
    await f.request(
      "/api/projects/project/storage",
      "GET",
      undefined,
      f.owner.token,
    )
  ).value.usage;
  expect(usage.objects).toBe(60);
  expect(usage.pending).toBe(0);
  const successful = responses.findIndex((response) => response.status === 200),
    digest = await hash(blocks[successful]);
  expect(
    (await f.put(`/api/projects/project/objects/${digest}`, blocks[successful]))
      .status,
  ).toBe(200);
  expect(
    (
      await f.request(
        "/api/projects/project/storage",
        "GET",
        undefined,
        f.owner.token,
      )
    ).value.usage.objects,
  ).toBe(60);
});

test("resumable upload survives a real server restart, validates immutable parts and publishes a complete object", async () => {
  const f = await fixture();
  const bytes = Buffer.alloc(uploadPartBytes + 12345, 7),
    digest = await hash(bytes),
    base = "/api/projects/project/objects";
  const begun = await f.request(
    base + "/uploads",
    "POST",
    { digest, bytes: bytes.length },
    f.owner.token,
  );
  expect(begun.status).toBe(200);
  const id = begun.value.id,
    first = bytes.subarray(0, uploadPartBytes),
    partDigest = await hash(first);
  expect(
    (await f.put(`${base}/uploads/${id}/parts/0?digest=${partDigest}`, first))
      .status,
  ).toBe(200);
  expect(
    (
      await f.request(
        `${base}/uploads/${id}/complete`,
        "POST",
        undefined,
        f.owner.token,
      )
    ).status,
  ).not.toBe(200);
  await f.restart();
  const resumed = await f.request(
    base + "/uploads",
    "POST",
    { digest, bytes: bytes.length },
    f.owner.token,
  );
  expect(resumed.value.id).toBe(id);
  expect(resumed.value.parts).toHaveLength(1);
  expect(
    (
      await f.put(
        `${base}/uploads/${id}/parts/0?digest=${"a".repeat(64)}`,
        first,
      )
    ).status,
  ).toBe(409);
  await resumableUpload(f.url() + base, f.owner.token, digest, bytes);
  const response = await fetch(f.url() + base + "/" + digest, {
    headers: { authorization: `Bearer ${f.owner.token}` },
  });
  expect(response.status).toBe(200);
  expect(await hash(new Uint8Array(await response.arrayBuffer()))).toBe(digest);
  expect(
    (
      await f.request(
        base + "/uploads",
        "POST",
        { digest, bytes: bytes.length },
        f.owner.token,
      )
    ).value.completed,
  ).toBe(true);
  expect(
    (
      await f.request(
        "/api/projects/project/storage",
        "GET",
        undefined,
        f.owner.token,
      )
    ).value.usage.pending,
  ).toBe(0);
});

test("pending uploads belong to their account and live project permission, and incomplete or corrupt uploads stay invisible", async () => {
  const f = await fixture(),
    editor = await f.register("editor"),
    other = await f.register("other");
  const invite = (
    await f.request(
      "/api/projects/project/invites",
      "POST",
      { role: "editor" },
      f.owner.token,
    )
  ).value;
  for (const user of [editor, other])
    expect(
      (
        await f.request(
          "/api/invites/accept",
          "POST",
          { invite: invite.invite },
          user.token,
        )
      ).status,
    ).toBe(200);
  const bytes = Buffer.alloc(uploadPartBytes + 1, 9),
    digest = await hash(bytes),
    base = "/api/projects/project/objects";
  const begun = (
    await f.request(
      base + "/uploads",
      "POST",
      { digest, bytes: bytes.length },
      editor.token,
    )
  ).value;
  expect(
    (
      await f.request(
        `${base}/uploads/${begun.id}`,
        "GET",
        undefined,
        other.token,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await f.request(
        `${base}/uploads/${begun.id}/complete`,
        "POST",
        undefined,
        editor.token,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await f.put(
        `${base}/uploads/${begun.id}/parts/0?digest=${"a".repeat(64)}`,
        bytes.subarray(0, uploadPartBytes),
        editor.token,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await fetch(f.url() + base + "/" + digest, {
        headers: { authorization: `Bearer ${editor.token}` },
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await f.request(
        "/api/projects/project/members",
        "PATCH",
        { userId: editor.user.id, role: null },
        f.owner.token,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.request(
        `${base}/uploads/${begun.id}`,
        "GET",
        undefined,
        editor.token,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await f.put(
        `${base}/uploads/${begun.id}/parts/0?digest=${await hash(bytes.subarray(0, uploadPartBytes))}`,
        bytes.subarray(0, uploadPartBytes),
        editor.token,
      )
    ).status,
  ).toBe(403);
});

test("daily upload and project creation budgets persist across server instances", async () => {
  const f = await fixture({ accountDailyUploads: 1, accountProjects: 1 });
  const first = Buffer.from("first"),
    second = Buffer.from("second");
  expect(
    (await f.put(`/api/projects/project/objects/${await hash(first)}`, first))
      .status,
  ).toBe(200);
  await f.restart();
  expect(
    (await f.put(`/api/projects/project/objects/${await hash(second)}`, second))
      .status,
  ).toBe(507);
  expect(
    (
      await f.request(
        "/api/projects",
        "POST",
        { id: "second-project", name: "Second" },
        f.owner.token,
      )
    ).status,
  ).toBe(507);
  const db = new SQLiteMetadata(join(f.home, "metadata.sqlite"));
  try {
    expect(
      (
        await db.all<{ hits: number }>(
          "SELECT hits FROM upload_budgets WHERE user_id=?",
          [f.owner.user.id],
        )
      )[0].hits,
    ).toBe(1);
  } finally {
    db.close();
  }
});

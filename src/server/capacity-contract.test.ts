import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteMetadata, startSyncServer } from "./node";
import { hash, syncProtocol, type ProjectSnapshot } from "../sync/protocol";

test("large manifests live in object storage and bounded summary/legacy histories retain stable cursors", async () => {
  const home = await mkdtemp(join(tmpdir(), "showai-capacity-"));
  const server = process.env.SHOWAI_SYNC_TEST_URL
    ? undefined
    : await startSyncServer({
        home,
        port: 0,
        registrationKey: "capacity-key",
        registrationLimit: 120,
      });
  const url = process.env.SHOWAI_SYNC_TEST_URL ?? server!.url;
  const request = async (
    path: string,
    method = "GET",
    data?: unknown,
    token?: string,
  ) => {
    const response = await fetch(url + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(data ? { "content-type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return { status: response.status, value: await response.json() };
  };
  try {
    const account = await request("/api/auth/register", "POST", {
      name: `capacity-${crypto.randomUUID()}`,
      password: "capacity-password-2026",
      registrationKey: process.env.SHOWAI_SYNC_TEST_KEY ?? "capacity-key",
    });
    expect(account.status).toBe(201);
    const token = account.value.token as string,
      id = crypto.randomUUID();
    expect(
      (
        await request(
          "/api/projects",
          "POST",
          { id, name: "Large manifest" },
          token,
        )
      ).status,
    ).toBe(201);
    const metadata = Buffer.from(
        JSON.stringify({ id, name: "Large manifest" }),
      ),
      data = Buffer.from("reused real content"),
      metaDigest = await hash(metadata),
      dataDigest = await hash(data);
    for (const [digest, bytes] of [
      [metaDigest, metadata],
      [dataDigest, data],
    ] as const)
      expect(
        (
          await fetch(url + `/api/projects/${id}/objects/${digest}`, {
            method: "PUT",
            headers: { authorization: `Bearer ${token}` },
            body: Uint8Array.from(bytes),
          })
        ).status,
      ).toBe(200);
    const files: Record<string, string> = {
      [`projects/${id}/project.json`]: metaDigest,
    };
    for (
      let index = 0;
      index < Number(process.env.SHOWAI_CAPACITY_FILES ?? 3500);
      index++
    )
      files[
        `projects/${id}/data/${index}/${"x".repeat(Number(process.env.SHOWAI_CAPACITY_PATH ?? 650))}.txt`
      ] = dataDigest;
    const snapshot: ProjectSnapshot = {
      format: syncProtocol,
      projectId: id,
      parents: [],
      files,
      change: {
        at: new Date().toISOString(),
        actor: { kind: "human" },
        channel: "cli",
        operationId: "large-manifest",
        paths: [`projects/${id}/project.json`],
      },
    };
    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeGreaterThan(
      2_000_000,
    );
    let head: string | null = null;
    const expected: string[] = [];
    for (let index = 0; index < 3; index++) {
      const current = {
        ...snapshot,
        parents: head ? [head] : [],
        change: { ...snapshot.change, operationId: `large-${index}` },
      };
      const result = await request(
        `/api/projects/${id}/revisions`,
        "POST",
        { snapshot: current, expected: head },
        token,
      );
      expect(result.status).toBe(200);
      head = result.value.head;
      expected.push(head!);
    }
    const summary = await request(
      `/api/projects/${id}/revisions?summary=1&limit=2`,
      "GET",
      undefined,
      token,
    );
    expect(
      summary.value.entries.map(
        (entry: { revision: string }) => entry.revision,
      ),
    ).toEqual(expected.slice(0, 2));
    expect(
      summary.value.entries.every(
        (entry: { snapshot?: unknown }) => !entry.snapshot,
      ),
    ).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(summary.value))).toBeLessThan(4096);
    const last = await request(
      `/api/projects/${id}/revisions?summary=1&after=${summary.value.next}`,
      "GET",
      undefined,
      token,
    );
    expect(
      last.value.entries.map((entry: { revision: string }) => entry.revision),
    ).toEqual(expected.slice(2));
    const legacy = await request(
      `/api/projects/${id}/revisions`,
      "GET",
      undefined,
      token,
    );
    expect(legacy.value.entries).toHaveLength(1);
    expect(legacy.value.next).toBe(expected[0]);
    expect(
      (
        await request(
          `/api/projects/${id}/revisions/${head}`,
          "GET",
          undefined,
          token,
        )
      ).value.snapshot.files,
    ).toEqual(files);
    if (server) {
      const db = new SQLiteMetadata(join(home, "metadata.sqlite"));
      try {
        const rows = await db.all<{
          manifest: string;
          manifest_key: string;
          manifest_bytes: number;
          sequence: number;
        }>(
          "SELECT manifest,manifest_key,manifest_bytes,sequence FROM revisions WHERE project_id=? ORDER BY sequence",
          [id],
        );
        expect(
          rows.every(
            (row) =>
              row.manifest === "" &&
              row.manifest_key.startsWith(`projects/${id}/manifests/`) &&
              row.manifest_bytes > 2_000_000,
          ),
        ).toBe(true);
        expect(rows.map((row) => row.sequence)).toEqual([1, 2, 3]);
      } finally {
        db.close();
      }
    }
  } finally {
    if (server) await server.close();
    await rm(home, { recursive: true });
  }
});

test("64 MiB objects stream through real HTTP with incremental integrity checks", async () => {
  const home = await mkdtemp(join(tmpdir(), "showai-streaming-"));
  const server = process.env.SHOWAI_SYNC_TEST_URL
    ? undefined
    : await startSyncServer({
        home,
        port: 0,
        registrationKey: "capacity-key",
        registrationLimit: 120,
      });
  const url = process.env.SHOWAI_SYNC_TEST_URL ?? server!.url;
  try {
    const registered = await fetch(url + "/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `stream-${crypto.randomUUID()}`,
        password: "capacity-password-2026",
        registrationKey: process.env.SHOWAI_SYNC_TEST_KEY ?? "capacity-key",
      }),
    });
    expect(registered.status).toBe(201);
    const token = (await registered.json()).token,
      id = crypto.randomUUID(),
      headers = { authorization: `Bearer ${token}` };
    await fetch(url + "/api/projects", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ id, name: "Streaming capacity" }),
    });
    const { createHash } = await import("node:crypto"),
      block = new Uint8Array(64 * 1024).fill(42),
      digest = createHash("sha256");
    for (let index = 0; index < 1024; index++) digest.update(block);
    const name = digest.digest("hex"),
      path = `/api/projects/${id}/objects/${name}`;
    const input = (count: number) => {
      let left = count;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!left--) controller.close();
          else controller.enqueue(block);
        },
      });
    };
    const uploaded = await fetch(url + path, {
      method: "PUT",
      headers,
      body: input(1024),
      duplex: "half",
    } as RequestInit);
    expect(uploaded.status).toBe(200);
    const downloaded = await fetch(url + path, { headers }),
      verify = createHash("sha256");
    let bytes = 0;
    expect(downloaded.status).toBe(200);
    for await (const chunk of downloaded.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength;
      verify.update(chunk);
    }
    expect(bytes).toBe(64 * 1024 * 1024);
    expect(verify.digest("hex")).toBe(name);
    const wrong = await fetch(
      url + `/api/projects/${id}/objects/${"a".repeat(64)}`,
      { method: "PUT", headers, body: input(1), duplex: "half" } as RequestInit,
    );
    expect(wrong.status).toBe(400);
    const large = await fetch(
      url + `/api/projects/${id}/objects/${"b".repeat(64)}`,
      {
        method: "PUT",
        headers,
        body: input(1025),
        duplex: "half",
      } as RequestInit,
    );
    expect(large.status).toBe(413);
    expect(
      (
        await fetch(url + `/api/projects/${id}/objects/${"b".repeat(64)}`, {
          headers,
        })
      ).status,
    ).toBe(404);
  } finally {
    if (server) await server.close();
    await rm(home, { recursive: true });
  }
}, 120_000);

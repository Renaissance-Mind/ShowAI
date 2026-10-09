import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startSyncServer } from "./node";
import { createHash } from "node:crypto";
import { canonical, hash, syncProtocol } from "../sync/protocol";

test("legacy full history and individual manifests share the download budget while summaries remain readable", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-history-budget-"));
  const projectId = crypto.randomUUID();
  const metadata = Buffer.from(
    JSON.stringify({ id: projectId, name: "History budget" }),
  );
  const digest = await hash(metadata);
  const snapshot = {
    format: syncProtocol,
    projectId,
    parents: [],
    files: { [`projects/${projectId}/project.json`]: digest },
    change: {
      at: new Date().toISOString(),
      actor: { kind: "system" as const },
      channel: "cli" as const,
      operationId: "history-budget",
      paths: [`projects/${projectId}/project.json`],
    },
  };
  const manifestBytes = Buffer.byteLength(canonical(snapshot));
  const server = await startSyncServer({
    home: root,
    port: 0,
    registrationMode: "open",
    requestPolicy: {
      accountDailyReadBytes: manifestBytes * 2,
      serviceDailyReadBytes: manifestBytes * 10,
    },
  });
  try {
    const account = await (
      await fetch(server.url + "/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "history-budget-user",
          password: "history-budget-password-2026",
        }),
      })
    ).json();
    const headers = { authorization: `Bearer ${account.token}` };
    const project = await fetch(server.url + "/api/projects", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ id: projectId, name: "History budget" }),
    });
    expect(project.status).toBe(201);
    await project.arrayBuffer();
    const object = await fetch(
      server.url + `/api/projects/${projectId}/objects/${digest}`,
      { method: "PUT", headers, body: metadata },
    );
    expect(object.status).toBe(200);
    await object.arrayBuffer();
    const published = await fetch(
      server.url + `/api/projects/${projectId}/revisions`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ snapshot, expected: null }),
      },
    );
    expect(published.status).toBe(200);
    const { revision } = await published.json();
    const full = await fetch(
      server.url + `/api/projects/${projectId}/revisions`,
      { headers },
    );
    expect(full.status).toBe(200);
    expect((await full.json()).entries[0].snapshot).toEqual(snapshot);
    const single = await fetch(
      server.url + `/api/projects/${projectId}/revisions/${revision}`,
      { headers },
    );
    expect(single.status).toBe(200);
    await single.arrayBuffer();
    const denied = await fetch(
      server.url + `/api/projects/${projectId}/revisions`,
      { headers },
    );
    expect(denied.status).toBe(429);
    expect((await denied.json()).error.code).toBe("READ_BUDGET_EXCEEDED");
    const summary = await fetch(
      server.url + `/api/projects/${projectId}/revisions?summary=1`,
      { headers },
    );
    expect(summary.status).toBe(200);
    const entries = (await summary.json()).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].snapshot).toBeUndefined();
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("request credits enforce per-account and global daily budgets across two real instances", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-request-budget-"));
  const first = await startSyncServer({
    home: root,
    port: 0,
    registrationMode: "open",
    operationsKey: "a".repeat(64),
    requestPolicy: {
      accountDailyRequests: 4,
      serviceDailyRequests: 100,
      grantRequests: 1,
    },
  });
  const second = await startSyncServer({
    home: root,
    port: 0,
    registrationMode: "open",
    operationsKey: "a".repeat(64),
    requestPolicy: {
      accountDailyRequests: 4,
      serviceDailyRequests: 100,
      grantRequests: 1,
    },
  });
  try {
    const registered = await (
      await fetch(first.url + "/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "budget-user",
          password: "budget-password-2026",
        }),
      })
    ).json();
    const results = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const response = await fetch(
          (index % 2 ? first : second).url + "/api/me",
          { headers: { authorization: `Bearer ${registered.token}` } },
        );
        const data = await response.json();
        return {
          status: response.status,
          code: data.error?.code,
          retry: response.headers.get("retry-after"),
        };
      }),
    );
    expect(results.filter((item) => item.status === 200)).toHaveLength(4);
    expect(
      results.filter((item) => item.code === "REQUEST_BUDGET_EXCEEDED"),
    ).toHaveLength(16);
    expect(
      results
        .filter((item) => item.status === 429)
        .every((item) => Number(item.retry) > 0),
    ).toBe(true);
    const usage = await (
      await fetch(first.url + "/api/ops/budget", {
        headers: { authorization: `Bearer ${"a".repeat(64)}` },
      })
    ).json();
    expect(usage.serviceReservedRequests).toBe(21);
  } finally {
    await second.close();
    await first.close();
    await rm(root, { recursive: true, force: true });
  }
  const globalRoot = await mkdtemp(join(tmpdir(), "showai-global-budget-"));
  const servers = await Promise.all(
    [0, 1].map(() =>
      startSyncServer({
        home: globalRoot,
        port: 0,
        requestPolicy: {
          serviceDailyRequests: 5,
          accountDailyRequests: 100,
          grantRequests: 1,
        },
      }),
    ),
  );
  try {
    const status = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const response = await fetch(servers[index % 2].url + "/api/projects");
        await response.body?.cancel();
        return response.status;
      }),
    );
    expect(status.filter((item) => item === 401)).toHaveLength(5);
    expect(status.filter((item) => item === 429)).toHaveLength(15);
  } finally {
    for (const server of servers) await server.close();
    await rm(globalRoot, { recursive: true, force: true });
  }
});

test("download byte budgets charge verified object sizes and reject without overcharging service credits", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-read-budget-"));
  const server = await startSyncServer({
    home: root,
    port: 0,
    registrationMode: "open",
    requestPolicy: { accountDailyReadBytes: 4, serviceDailyReadBytes: 6 },
  });
  try {
    const users = [];
    const bytes = Buffer.from("abc"),
      digest = createHash("sha256").update(bytes).digest("hex");
    for (let index = 0; index < 2; index++) {
      const user = await (
        await fetch(server.url + "/api/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "read-user-" + index,
            password: "read-budget-password-2026",
          }),
        })
      ).json();
      const id = crypto.randomUUID();
      const created = await fetch(server.url + "/api/projects", {
        method: "POST",
        headers: {
          authorization: `Bearer ${user.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id, name: "Byte budget" }),
      });
      await created.body?.cancel();
      const put = await fetch(
        server.url + `/api/projects/${id}/objects/${digest}`,
        {
          method: "PUT",
          headers: { authorization: `Bearer ${user.token}` },
          body: bytes,
        },
      );
      expect(put.status).toBe(200);
      await put.body?.cancel();
      users.push({ token: user.token, id });
    }
    const download = async (user: { token: string; id: string }) => {
      const response = await fetch(
        server.url + `/api/projects/${user.id}/objects/${digest}`,
        { headers: { authorization: `Bearer ${user.token}` } },
      );
      const body = await response.arrayBuffer();
      return { status: response.status, bytes: body.byteLength };
    };
    expect(await download(users[0])).toEqual({ status: 200, bytes: 3 });
    expect((await download(users[0])).status).toBe(429);
    expect(await download(users[1])).toEqual({ status: 200, bytes: 3 });
    expect((await download(users[1])).status).toBe(429);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startSyncServer } from "./node";

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

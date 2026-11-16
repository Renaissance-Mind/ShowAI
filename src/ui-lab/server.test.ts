import { afterAll, beforeAll, expect, test } from "vitest";
import { access, mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startUiLab } from "./server";
import type { LabSession } from "./types";

let directory: string, lab: Awaited<ReturnType<typeof startUiLab>>;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "showai-ui-lab-server-"));
  lab = await startUiLab({
    repository: process.cwd(),
    state: join(directory, "state"),
    output: join(directory, "results"),
    idleSessionMs: 400,
  });
});
afterAll(async () => {
  await lab?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
const post = (path: string, input: unknown, token?: string) =>
  fetch(lab.origin + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
  });
test("shutdown checks server identity and waits for owned cleanup", async () => {
  let completed = false;
  const state = join(directory, "shutdown-state");
  const owned = await startUiLab({
    repository: process.cwd(),
    state,
    output: join(directory, "shutdown-results"),
    onShutdown: async () => {
      await owned.close();
      completed = true;
    },
  });
  try {
    const request = (pid: number) =>
      fetch(owned.origin + "/__ui-lab/api/shutdown", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pid }),
      });
    expect((await request(-1)).status).toBe(403);
    expect((await request(process.pid)).ok).toBe(true);
    await expect.poll(() => completed).toBe(true);
    expect(
      JSON.parse(await readFile(join(state, "closed.json"), "utf8")).pid,
    ).toBe(process.pid);
  } finally {
    await owned.close();
  }
});
async function session(): Promise<LabSession> {
  const response = await post("/__ui-lab/api/sessions", {
    feature: "remote-connection",
    scene: "overview",
    mode: "test",
  });
  expect(response.ok).toBe(true);
  return response.json();
}
async function invoke(client: LabSession, action: string, args = {}) {
  const response = await post("/api/invoke", { action, args }, client.token);
  const result = await response.json();
  expect(response.ok).toBe(true);
  expect(result.ok).toBe(true);
  return result.data;
}

test("closed Demo tabs release sessions while connected applications stay alive", async () => {
  const response = await post("/__ui-lab/api/sessions", {
    feature: "workbench",
    scene: "basic",
    mode: "manual",
  });
  const client: LabSession = await response.json();
  const controller = new AbortController();
  const events = await fetch(
    `${lab.origin}/api/events?token=${client.token}&client=ui-lab-lifecycle`,
    { signal: controller.signal },
  );
  const reader = events.body!.getReader();
  await reader.read();
  reader.releaseLock();
  const status = async () =>
    fetch(lab.origin + "/__ui-lab/api/status").then((response) =>
      response.json(),
    );
  try {
    await expect
      .poll(
        async () =>
          (await status()).sessions.find(
            (item: { id: string }) => item.id === client.id,
          )?.connectedClients,
      )
      .toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(
      (await status()).sessions.some(
        (item: { id: string }) => item.id === client.id,
      ),
    ).toBe(true);
  } finally {
    controller.abort();
  }
  await expect
    .poll(async () =>
      (await status()).sessions.some(
        (item: { id: string }) => item.id === client.id,
      ),
    )
    .toBe(false);
  await expect
    .poll(async () =>
      access(client.home).then(
        () => true,
        () => false,
      ),
    )
    .toBe(false);
});

test("sessions render the real entry, isolate application storage, and clean runtime files after close", async () => {
  const one = await session(),
    two = await session();
  try {
    expect(one.home).not.toBe(two.home);
    expect(one.home).toContain(directory);
    const html = await fetch(one.appUrl).then((response) => response.text());
    expect(html).toContain("/src/main.tsx");
    expect(html).toContain("__SHOWAI_UI_LAB__");
    await invoke(one, "projects:create", {
      name: "Created through the real workbench",
    });
    expect(await invoke(one, "projects:list")).toHaveLength(3);
    expect(await invoke(two, "projects:list")).toHaveLength(2);
    await invoke(one, "remoteMcp:start", {
      config: {
        provider: "lan",
        publicUrl: "",
        port: 0,
        executable: "",
        bindAddress: "192.168.50.20",
        access: "all",
        projects: [],
      },
    });
    expect((await invoke(one, "remoteMcp:status")).phase).toBe("starting");
    expect((await invoke(two, "remoteMcp:status")).phase).toBe("stopped");
    expect(
      (
        await post(
          `/__ui-lab/api/sessions/${one.id}/events`,
          { name: "service.ready" },
          one.token,
        )
      ).ok,
    ).toBe(true);
    expect((await invoke(one, "remoteMcp:status")).phase).toBe("running");
  } finally {
    for (const client of [one, two]) {
      expect(
        (
          await fetch(`${lab.origin}/__ui-lab/api/sessions/${client.id}`, {
            method: "DELETE",
            headers: { authorization: `Bearer ${client.token}` },
          })
        ).ok,
      ).toBe(true);
      await expect(access(client.home)).rejects.toThrow();
    }
  }
});

test("session APIs reject foreign origins, wrong tokens, unknown scenes and invalid input", async () => {
  const foreign = await fetch(lab.origin + "/__ui-lab/api/catalog", {
    headers: { origin: "https://example.com" },
  });
  expect(foreign.status).toBe(403);
  expect((await post("/__ui-lab/api/sessions", [])).status).toBe(400);
  expect(
    (await post("/__ui-lab/api/sessions", { feature: "unknown" })).status,
  ).toBe(400);
  const client = await session();
  try {
    expect(
      (
        await post(
          "/api/invoke",
          { action: "projects:list", args: {} },
          "invalid",
        )
      ).status,
    ).toBe(401);
    expect(
      (await fetch(`${lab.origin}/__ui-lab/api/sessions/${client.id}/inspect`))
        .status,
    ).toBe(401);
    expect(
      (
        await fetch(`${lab.origin}/__ui-lab/api/sessions/${client.id}/events`, {
          headers: { authorization: `Bearer ${client.token}` },
        })
      ).status,
    ).toBe(405);
    const denied = await post(
      "/api/invoke",
      { action: "fs:reveal", args: {} },
      client.token,
    );
    expect((await denied.json()).ok).toBe(false);
  } finally {
    await fetch(`${lab.origin}/__ui-lab/api/sessions/${client.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${client.token}` },
    });
  }
});

import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startSyncServer } from "./node";
import { hash } from "../sync/protocol";
import { resumableUpload } from "../sync/resumable-upload";
import { uploadPartBytes } from "./uploads";

test("real deployed resumable transfers retain verified parts and enforce account/project boundaries", async () => {
  const home = await mkdtemp(join(tmpdir(), "showai-upload-portable-"));
  const server = process.env.SHOWAI_SYNC_TEST_URL
    ? undefined
    : await startSyncServer({
        home,
        port: 0,
        registrationKey: "portable-key",
        registrationLimit: 120,
      });
  const url = process.env.SHOWAI_SYNC_TEST_URL ?? server!.url,
    suffix = crypto.randomUUID();
  const request = async (
    path: string,
    method = "GET",
    input?: unknown,
    credential?: string,
  ) => {
    const response = await fetch(url + path, {
      method,
      headers: {
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        ...(input ? { "content-type": "application/json" } : {}),
      },
      body: input ? JSON.stringify(input) : undefined,
    });
    return { status: response.status, value: await response.json() };
  };
  const register = async (label: string) => {
    const result = await request("/api/auth/register", "POST", {
      name: `${label}-${suffix}`,
      password: "portable-upload-password",
      registrationKey: process.env.SHOWAI_SYNC_TEST_KEY ?? "portable-key",
    });
    expect(result.status).toBe(201);
    return result.value;
  };
  try {
    const owner = await register("owner"),
      other = await register("other"),
      project = crypto.randomUUID();
    expect(
      (
        await request(
          "/api/projects",
          "POST",
          { id: project, name: "Portable resume contract" },
          owner.token,
        )
      ).status,
    ).toBe(201);
    const bytes = Buffer.alloc(uploadPartBytes + 8765, 11),
      digest = await hash(bytes),
      base = `/api/projects/${project}/objects`;
    const begun = await request(
      base + "/uploads",
      "POST",
      { digest, bytes: bytes.length },
      owner.token,
    );
    expect(begun.status).toBe(200);
    expect(
      (
        await request(
          `${base}/uploads/${begun.value.id}`,
          "GET",
          undefined,
          other.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(
          url +
            `${base}/uploads/${begun.value.id}/parts/0?digest=${await hash(bytes.subarray(0, uploadPartBytes))}`,
          {
            method: "PUT",
            headers: { authorization: `Bearer ${owner.token}` },
            body: Uint8Array.from(bytes.subarray(0, uploadPartBytes)),
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `${base}/uploads/${begun.value.id}/complete`,
          "POST",
          undefined,
          owner.token,
        )
      ).status,
    ).toBe(409);
    const retained = await request(
      base + "/uploads",
      "POST",
      { digest, bytes: bytes.length },
      owner.token,
    );
    expect(retained.value.id).toBe(begun.value.id);
    expect(retained.value.parts).toHaveLength(1);
    await resumableUpload(url + base, owner.token, digest, bytes);
    const response = await fetch(url + base + "/" + digest, {
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(response.status).toBe(200);
    expect(await hash(new Uint8Array(await response.arrayBuffer()))).toBe(
      digest,
    );
    const usage = (
      await request(
        `/api/projects/${project}/storage`,
        "GET",
        undefined,
        owner.token,
      )
    ).value;
    expect(usage.usage.objects).toBe(bytes.length);
    expect(usage.usage.pending).toBe(0);
    expect(usage.policy.projectBytes).toBeGreaterThanOrEqual(64 * 1024 * 1024);
  } finally {
    if (server) await server.close();
    await rm(home, { recursive: true });
  }
}, 120_000);

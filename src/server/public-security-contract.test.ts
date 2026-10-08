import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startSyncServer } from "./node";

test("deployed account/session/invitation protections work through real HTTP", async () => {
  const home = await mkdtemp(join(tmpdir(), "showai-public-security-"));
  const local = process.env.SHOWAI_SYNC_TEST_URL
    ? undefined
    : await startSyncServer({
        home,
        port: 0,
        registrationKey: "contract-key",
        registrationLimit: 120,
      });
  const base = process.env.SHOWAI_SYNC_TEST_URL ?? local!.url,
    key = process.env.SHOWAI_SYNC_TEST_KEY ?? "contract-key",
    suffix = crypto.randomUUID();
  const request = async (
    path: string,
    method = "GET",
    input?: unknown,
    credential?: string,
  ) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        ...(input ? { "content-type": "application/json" } : {}),
      },
      body: input ? JSON.stringify(input) : undefined,
    });
    return {
      status: response.status,
      retryAfter: response.headers.get("retry-after"),
      value: await response.json(),
    };
  };
  const register = async (kind: string) => {
    const result = await request("/api/auth/register", "POST", {
      name: `${kind}-${suffix}`,
      password: "contract-password-2026",
      registrationKey: key,
    });
    expect(result.status).toBe(201);
    return result.value as {
      user: { id: string; name: string };
      token: string;
      expiresAt: string;
    };
  };
  try {
    const info = await request("/api/info");
    expect(info.value.passwordMinimum).toBe(12);
    expect(info.value.registration).toBe("controlled");
    const owner = await register("owner"),
      editor = await register("editor"),
      viewer = await register("viewer");
    expect(
      (
        await request("/api/auth/register", "POST", {
          name: `short-${suffix}`,
          password: "short",
          registrationKey: key,
        })
      ).status,
    ).toBe(400);
    const projectId = crypto.randomUUID();
    expect(
      (
        await request(
          "/api/projects",
          "POST",
          { id: projectId, name: "Public security contract" },
          owner.token,
        )
      ).status,
    ).toBe(201);
    const invite = (
      await request(
        `/api/projects/${projectId}/invites`,
        "POST",
        { role: "editor", maxUses: 1, targetName: editor.user.name },
        owner.token,
      )
    ).value;
    expect(
      (
        await request(
          "/api/invites/accept",
          "POST",
          { invite: invite.invite },
          viewer.token,
        )
      ).status,
    ).toBe(410);
    expect(
      (
        await request(
          "/api/invites/accept",
          "POST",
          { invite: invite.invite },
          editor.token,
        )
      ).status,
    ).toBe(200);
    const viewerInvite = (
      await request(
        `/api/projects/${projectId}/invites`,
        "POST",
        { role: "viewer", maxUses: 1 },
        owner.token,
      )
    ).value;
    expect(
      (
        await request(
          "/api/invites/accept",
          "POST",
          { invite: viewerInvite.invite },
          viewer.token,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/projects/${projectId}/invites`,
          "POST",
          { role: "admin" },
          viewer.token,
        )
      ).status,
    ).toBe(403);
    const single = (
      await request(
        `/api/projects/${projectId}/invites`,
        "POST",
        { role: "viewer", maxUses: 1 },
        owner.token,
      )
    ).value;
    const claims = await Promise.all(
      ["first", "second"].map((name) =>
        request("/api/auth/register", "POST", {
          name: `${name}-${suffix}`,
          password: "contract-password-2026",
          invite: single.invite,
        }),
      ),
    );
    expect(claims.map((claim) => claim.status).sort()).toEqual([201, 403]);
    const shared = (
      await request(
        `/api/projects/${projectId}/invites`,
        "POST",
        { role: "editor", maxUses: null },
        owner.token,
      )
    ).value;
    expect(
      (
        await request(
          "/api/invites/accept",
          "POST",
          { invite: shared.invite },
          editor.token,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/projects/${projectId}/members`,
          "PATCH",
          { userId: editor.user.id, role: null, revokeInvites: true },
          owner.token,
        )
      ).status,
    ).toBe(200);
    expect(
      (await request("/api/invites/preview", "POST", { invite: shared.invite }))
        .status,
    ).toBe(410);
    expect(
      (
        await request(
          `/api/projects/${projectId}`,
          "GET",
          undefined,
          editor.token,
        )
      ).status,
    ).toBe(403);
    const changed = await request(
      "/api/auth/password",
      "POST",
      {
        currentPassword: "contract-password-2026",
        newPassword: "rotated-contract-password-2026",
      },
      owner.token,
    );
    expect(changed.status).toBe(200);
    expect(
      (await request("/api/me", "GET", undefined, owner.token)).status,
    ).toBe(401);
    expect(
      (await request("/api/me", "GET", undefined, changed.value.token)).status,
    ).toBe(200);
    expect(
      (
        await request(
          "/api/sessions/revoke-all",
          "POST",
          {},
          changed.value.token,
        )
      ).status,
    ).toBe(200);
    expect(
      (await request("/api/me", "GET", undefined, changed.value.token)).status,
    ).toBe(401);
    const attempts = await Promise.all(
      Array.from({ length: 13 }, () =>
        request("/api/auth/login", "POST", {
          name: `missing-${suffix}`,
          password: "wrong-contract-password",
        }),
      ),
    );
    expect(attempts.filter((attempt) => attempt.status === 401)).toHaveLength(
      12,
    );
    expect(attempts.filter((attempt) => attempt.status === 429)).toHaveLength(
      1,
    );
    expect(
      Number(attempts.find((attempt) => attempt.status === 429)!.retryAfter),
    ).toBeGreaterThan(0);
  } finally {
    if (local) await local.close();
    await rm(home, { recursive: true });
  }
});

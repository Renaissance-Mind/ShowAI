import { expect, it } from "vitest";
import { expiredConnections, syncMarker } from "./useSyncOverview";
import type { ProjectConnection } from "../sync/protocol";

const binding = (patch: Partial<ProjectConnection>): ProjectConnection => ({
  projectId: "p",
  connectionId: "c",
  remoteProjectId: "p",
  role: "editor",
  remoteHead: null,
  localRevision: null,
  status: "synced",
  ...patch,
});

it("marks projects that are read-only, need sign-in or did not sync", () => {
  expect(syncMarker(undefined)).toBeUndefined();
  expect(syncMarker(binding({}))).toBeUndefined();
  expect(syncMarker(binding({ status: "pending" }))).toBeUndefined();
  expect(syncMarker(binding({ role: "viewer" }))).toBe("readOnly");
  expect(syncMarker(binding({ status: "revoked" }))).toBe("readOnly");
  expect(syncMarker(binding({ status: "offline", errorKind: "auth" }))).toBe(
    "signIn",
  );
  expect(
    syncMarker(binding({}), {
      id: "c",
      serverId: "s",
      name: "S",
      url: "https://s",
      user: { id: "u", name: "u" },
      signedOut: true,
    } as never),
  ).toBe("signIn");
  expect(
    syncMarker(binding({ status: "offline", errorKind: "network" })),
  ).toBe("unsynced");
  expect(syncMarker(binding({ status: "pending", error: "x" }))).toBe(
    "unsynced",
  );
});

it("groups projects whose sign-in expired by connection", () => {
  expect(
    expiredConnections({
      connections: [],
      projects: [
        binding({ projectId: "a", errorKind: "auth", status: "offline" }),
        binding({ projectId: "b", errorKind: "auth", status: "offline" }),
        binding({ projectId: "c", connectionId: "d", errorKind: "network" }),
      ],
    }),
  ).toEqual([
    { connection: undefined, connectionId: "c", projectIds: ["a", "b"] },
  ]);
});

import { expect, it } from "vitest";
import { managedProjects, type ProjectAccount } from "./managed-projects";
import type { ProjectConnection, SyncProject } from "../sync/protocol";
import type { ProjectSummary } from "../core/model";
const account = (id: string, serverId: string): ProjectAccount => ({
  id,
  serverId,
  url: "https://" + serverId,
  name: serverId,
  user: { id: "u", name: "U" },
});
const local = {
  id: "local-p",
  name: "Same name",
  archived: false,
} as ProjectSummary;
const binding: ProjectConnection = {
  projectId: "local-p",
  connectionId: "a",
  remoteProjectId: "remote-p",
  paused: true,
  role: "editor",
  remoteHead: null,
  localRevision: null,
  status: "synced",
};
const remote = (id: string): SyncProject => ({
  id,
  name: "Same name",
  archived: false,
  role: "editor",
  head: null,
});
it("joins stopped local copies to their server identity, and keeps same-name projects on other servers distinct", () => {
  const rows = managedProjects(
    [local],
    [binding],
    [account("a", "first"), account("b", "second"), account("c", "first")],
    {
      a: [remote("remote-p")],
      b: [remote("remote-p")],
      c: [remote("remote-p")],
    },
  );
  expect(rows).toHaveLength(2);
  expect(rows[0].local?.id).toBe("local-p");
  expect(rows[0].binding?.paused).toBe(true);
  expect(rows[1].connection?.serverId).toBe("second");
});
it("finds the existing local copy when filtering another account on the same server", () => {
  const rows = managedProjects(
    [local],
    [binding],
    [account("a", "first"), account("c", "first")],
    { c: [remote("remote-p")] },
    "c",
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].local?.id).toBe("local-p");
  expect(rows[0].connection?.id).toBe("c");
});

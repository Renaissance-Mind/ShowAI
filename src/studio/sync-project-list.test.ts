import { expect, it } from "vitest";
import { syncListedProjects } from "./sync-project-list";

it("leaves deleted projects out of the sync list unless they are still connected", () => {
  const projects = [
    { id: "active" },
    { id: "deleted", archived: true },
    { id: "deleted-connected", archived: true },
  ];
  expect(
    syncListedProjects(projects, new Set(["deleted-connected"])).map(
      (project) => project.id,
    ),
  ).toEqual(["active", "deleted-connected"]);
});

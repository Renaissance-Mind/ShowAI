import { randomUUID } from "node:crypto";
import { AgentService } from "../agent/service";
import { FileStore } from "../core/store";
import { withChangeContext } from "../core/history-context";
import type { RemoteMcpConfig } from "./types";

/** Resolve current library membership on every call, including projects created after consent. */
export function localLibraryPolicy(
  root: string,
  config: Pick<RemoteMcpConfig, "access" | "projects">,
) {
  return {
    access: config.access ?? ("all" as const),
    projects: async () =>
      (await new FileStore(root).listProjects({ includeArchived: true }))
        .filter(
          (p) =>
            config.access !== "selected" ||
            config.projects.some((rule) => rule.id === p.id),
        )
        .map((p) => ({
          id: p.id,
          name: p.name,
          archived: p.archived,
          role:
            config.access !== "selected" ||
            config.projects.find((rule) => rule.id === p.id)?.write
              ? ("admin" as const)
              : ("viewer" as const),
        })),
    createProject: async (name: string, operationId?: string) => {
      if (config.access === "selected")
        throw new Error("Project creation requires full-library access.");
      const project = await withChangeContext(
        {
          actor: { kind: "external", label: "Remote MCP" },
          channel: "mcp",
          operationId: operationId ?? randomUUID(),
        },
        () => new AgentService({ root }).createProject(name),
      );
      return {
        project,
        persistence: { storage: "local", synchronized: false },
      };
    },
  };
}

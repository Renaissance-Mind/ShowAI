import { DatasetStore } from "./datasets";
import { mutateLibrary } from "./library-runtime";
import { createProjectDatabaseData } from "./project-database";
import type { ProjectSummary } from "./model";
import type { FileStore } from "./store";

/** Called within project creation so its metadata and properties commit together. */
export function initializeProjectDatabase(
  store: FileStore,
  projectId: string,
): Promise<ProjectSummary> {
  return mutateLibrary(store.root, async () => {
    const project = await store.readProject(projectId);
    if (project.database)
      return {
        ...project,
        pageCount: (await store.listPages(projectId)).length,
      };
    const dataset = await new DatasetStore(store).create(projectId, {
      // Dataset labels have a smaller budget than project names.
      name: project.name.length <= 200 ? project.name : "数据库属性",
      origin: { kind: "project-database" },
      value: createProjectDatabaseData(),
    });
    return store.updateProject(projectId, {
      database: { datasetId: dataset.dataset.id },
    });
  });
}

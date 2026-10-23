import { parentPort } from "node:worker_threads";
import {
  FileStore,
  assertId,
  folderVisible,
  validateProjectMetadata,
} from "../core/store";
import {
  withLibrarySnapshot,
  libraryReadSnapshot,
} from "../core/library-runtime";
import { pageSummaries } from "../core/page-summaries";
import type { ProjectMetadata } from "../core/model";
import { pagePreviewSnapshot } from "./page-preview-snapshot";
import { resolveDocumentComponents } from "../core/catalog";
import { errorResult } from "../agent/service";

const port = parentPort;
if (!port) throw new Error("The page preview reader needs a parent channel.");
let queue = Promise.resolve();
port.on("message", ({ id, home, action, args }) => {
  queue = queue.then(async () => {
    try {
      const store = new FileStore(home);
      if (action === "pages:previewCandidates") {
        const data = await withLibrarySnapshot(home, async () => {
          const snapshot = libraryReadSnapshot.getStore();
          if (snapshot?.revision) {
            // Read the projection and project metadata in batches instead of
            // taking thousands of filesystem/path checks under the library lease.
            const summaries = await pageSummaries(
              snapshot.library,
              snapshot.revision,
            );
            const tree = await snapshot.library.tree(snapshot.revision);
            const paths = tree
              .map((entry) => entry.path)
              .filter((path) => /^projects\/[^/]+\/project\.json$/.test(path));
            const metadata = await snapshot.library.readFiles(
              paths,
              snapshot.revision,
            );
            const projects = new Map<string, ProjectMetadata>();
            for (const [path, bytes] of metadata) {
              const id = path.split("/")[1];
              try {
                const project = validateProjectMetadata(
                  JSON.parse(bytes.toString("utf8")),
                  id,
                );
                if (!project.archived) projects.set(id, project);
              } catch (error) {
                console.warn(
                  "Skipping invalid project during preview warmup",
                  id,
                  error,
                );
              }
            }
            return Object.entries(summaries)
              .flatMap(([path, { summary: page }]) => {
                const projectId = path.split("/")[1],
                  project = projects.get(projectId);
                if (
                  !project ||
                  page.archived ||
                  (page.parentId &&
                    project.folders?.some(
                      (folder) => folder.id === page.parentId,
                    ) &&
                    !folderVisible(project.folders ?? [], page.parentId))
                )
                  return [];
                return [
                  {
                    projectId,
                    pageId: page.id,
                    hash: page.hash,
                    updatedAt: page.updatedAt,
                  },
                ];
              })
              .sort(
                (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
              );
          }
          const projects = await store.listProjects();
          const pages = [];
          for (const project of projects) {
            for (const page of await store.listPages(project.id, {
              includeArchived: false,
            }))
              pages.push({
                projectId: project.id,
                pageId: page.id,
                hash: page.hash,
                updatedAt: page.updatedAt,
              });
          }
          return pages.sort(
            (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
          );
        });
        port.postMessage({ id, ok: true, data });
        return;
      }
      const projectId = assertId(args.projectId);
      const pageId = assertId(args.pageId);
      const snapshot = await pagePreviewSnapshot(home, projectId, pageId);
      const load = async () => {
        const record = await store.readPage(projectId, pageId, {
          checkpoint: false,
        });
        const components = await resolveDocumentComponents(
          home,
          record.document,
          projectId,
        );
        return { ...record, components };
      };
      const data = snapshot
        ? await libraryReadSnapshot.run(snapshot, load)
        : await load();
      port.postMessage({ id, ok: true, data });
    } catch (error) {
      port.postMessage({ id, ok: false, error: errorResult(error) });
    }
  });
});

import { parentPort } from "node:worker_threads";
import { FileStore, assertId } from "../core/store";
import { withLibrarySnapshot } from "../core/library-runtime";
import { resolveDocumentComponents } from "../core/catalog";
import { errorResult } from "../agent/service";

const port = parentPort;
if (!port) throw new Error("The page preview reader needs a parent channel.");
let queue = Promise.resolve();
port.on("message", ({ id, home, args }) => {
  queue = queue.then(async () => {
    try {
      const store = new FileStore(home);
      const projectId = assertId(args.projectId);
      const pageId = assertId(args.pageId);
      const data = await withLibrarySnapshot(home, async () => {
        const record = await store.readPage(projectId, pageId);
        const components = await resolveDocumentComponents(
          home,
          record.document,
          projectId,
        );
        return { ...record, components };
      });
      port.postMessage({ id, ok: true, data });
    } catch (error) {
      port.postMessage({ id, ok: false, error: errorResult(error) });
    }
  });
});

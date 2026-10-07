import { parentPort } from "node:worker_threads";
import { LibraryIndex } from "./library-index";
import { CoreError } from "./model";
const port = parentPort;
if (!port) throw new Error("Index worker requires a parent channel.");
let queue = Promise.resolve();
port.on("message", ({ id, home, action, args }) => {
  queue = queue.then(async () => {
    try {
      const index = new LibraryIndex(home);
      let data;
      switch (action) {
        case "search":
          data = await index.search(args);
          break;
        case "history":
          data = await index.history(args);
          break;
        case "references":
          data = await index.references(args.kind, args.id, args.options);
          break;
        case "synchronize":
          data = await index.synchronize(args.force);
          break;
        default:
          throw new Error("Unknown index operation.");
      }
      port.postMessage({ id, ok: true, data });
    } catch (error) {
      port.postMessage({
        id,
        ok: false,
        error:
          error instanceof CoreError
            ? {
                code: error.code,
                message: error.message,
                currentHash: error.currentHash,
                currentRevision: error.currentRevision,
                conflictId: error.conflictId,
              }
            : {
                code: "INVALID_DATA",
                message: error instanceof Error ? error.message : String(error),
              },
      });
    }
  });
});

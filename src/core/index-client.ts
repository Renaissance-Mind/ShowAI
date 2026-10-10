import { BackgroundWorker } from "./background-worker";
import type { LibraryIndex, SearchOptions } from "./library-index";
const worker = new BackgroundWorker();
const invoke = <T>(home: string, action: string, args: unknown) =>
  worker.invoke<T>(home, action, args);
/** CPU-heavy parsing, tokenisation and SQLite work stays outside the app's main thread. */
export class IndexClient {
  constructor(readonly home: string) {}
  search(input: SearchOptions): ReturnType<LibraryIndex["search"]> {
    return invoke(this.home, "search", input);
  }
  history(
    input: Parameters<LibraryIndex["history"]>[0],
  ): ReturnType<LibraryIndex["history"]> {
    return invoke(this.home, "history", input);
  }
  references(
    kind: string,
    id: string,
    options: Parameters<LibraryIndex["references"]>[2],
  ): ReturnType<LibraryIndex["references"]> {
    return invoke(this.home, "references", { kind, id, options });
  }
  synchronize(force = false): ReturnType<LibraryIndex["synchronize"]> {
    return invoke(this.home, "synchronize", { force });
  }
}

import type { LibraryDrop } from "./LibraryDrag";
import type { LibraryTarget } from "./LibraryNavigation";
import type { LibraryEntryFields } from "./navigation-refresh";

export interface LibraryPlace {
  projectId: string;
  parentId: string | null;
}

export type LibraryChange =
  | { kind: "move"; undo: LibraryDrop; redo: LibraryDrop }
  | { kind: "delete"; targets: LibraryTarget[] }
  | {
      kind: "rename";
      target: LibraryTarget;
      before: LibraryEntryFields;
      after: LibraryEntryFields;
    }
  | {
      kind: "batchMove";
      moves: { target: LibraryTarget; from: LibraryPlace; to: LibraryPlace }[];
    };

export class LibraryHistory<T = LibraryChange> {
  undo: T[] = [];
  redo: T[] = [];
  constructor(private readonly limit = 100) {}
  record(entry: T) {
    this.undo.push(entry);
    if (this.undo.length > this.limit) this.undo.shift();
    this.redo = [];
  }
  next(redo: boolean): T | undefined {
    return (redo ? this.redo : this.undo).at(-1);
  }
  replayed(entry: T, redo: boolean) {
    const from = redo ? this.redo : this.undo;
    const index = from.lastIndexOf(entry);
    if (index < 0) return;
    from.splice(index, 1);
    (redo ? this.undo : this.redo).push(entry);
  }
  clear() {
    this.undo = [];
    this.redo = [];
  }
}

export function reverseMoves(
  moves: Extract<LibraryChange, { kind: "batchMove" }>["moves"],
  redo: boolean,
): { target: LibraryTarget; destination: LibraryPlace }[] {
  return moves.map(({ target, from, to }) => {
    const [source, destination] = redo ? [from, to] : [to, from];
    return {
      target: {
        ...target,
        projectId: source.projectId,
        parentId: source.parentId,
      } as LibraryTarget,
      destination,
    };
  });
}

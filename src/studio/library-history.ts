import type { LibraryDrop } from "./LibraryDrag";
import type { LibraryTarget } from "./LibraryNavigation";
import type { LibraryEntryFields } from "./navigation-refresh";

export interface LibraryPlace {
  projectId: string;
  parentId: string | null;
}

/** One library change Cmd+Z can reverse: each kind knows its own inverse. */
export type LibraryChange =
  | { kind: "move"; undo: LibraryDrop; redo: LibraryDrop }
  /** Undo restores the deleted items; redo deletes them again. */
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

/** Undo and redo stacks for library changes; a new change discards the redo stack. */
export class LibraryHistory<T = LibraryChange> {
  undo: T[] = [];
  redo: T[] = [];
  constructor(private readonly limit = 100) {}
  record(entry: T) {
    this.undo.push(entry);
    if (this.undo.length > this.limit) this.undo.shift();
    this.redo = [];
  }
  /** The change Cmd+Z (or Shift+Cmd+Z when redoing) would replay next. */
  next(redo: boolean): T | undefined {
    return (redo ? this.redo : this.undo).at(-1);
  }
  /** After a successful replay the change moves to the other stack. */
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

/** The places a batch move came from become the destinations that undo it. */
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

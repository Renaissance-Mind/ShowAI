import { parseArtifact } from "./validation.mjs";

export class ReaderSource {
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(private value: string | null | undefined) {}

  read = () => this.value;

  subscribe = (listener: () => void) => {
    if (this.disposed) throw new Error("Reader source is disposed.");
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(value: string): void {
    if (this.disposed) throw new Error("Reader source is disposed.");
    if (typeof value !== "string")
      throw new Error("Reader update must contain serialized source.");
    parseArtifact(value);
    if (value === this.value) return;
    this.value = value;
    for (const listener of this.listeners) listener();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

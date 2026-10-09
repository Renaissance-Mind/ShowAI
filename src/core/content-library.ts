import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CoreError } from "./model";
import { SqliteLibrary } from "./sqlite-library";
import type { GitLibrary as LegacyLibrary } from "./git-library";
import type { ChangeContext, FileChanges } from "./history-model";
import type { WorkspaceConflict } from "./workspace-conflicts";
import { retainActivatedGit } from "./content-migration-journal";
import { withLibraryLock } from "./library-lock";

/** Storage-independent library contract. New libraries have no Git runtime. */
export class ContentLibrary {
  readonly root: string;
  readonly workspace: string;
  constructor(root: string) {
    this.root = resolve(root);
    this.workspace = join(this.root, "workspace");
  }
  private storage() {
    const marker = join(this.root, "library.json");
    if (!existsSync(marker))
      return existsSync(join(this.root, "repository.git")) ? "git" : "sqlite";
    const manifest = JSON.parse(readFileSync(marker, "utf8"));
    if (
      manifest.format !== "showai-library" ||
      manifest.version !== 2 ||
      (manifest.storage !== undefined && manifest.storage !== "sqlite")
    )
      throw new CoreError(
        "INVALID_DATA",
        "Unsupported content library format.",
      );
    return manifest.storage === "sqlite" ? "sqlite" : "git";
  }
  get repository() {
    return join(
      this.root,
      this.storage() === "sqlite" ? "history" : "repository.git",
    );
  }
  private async backend(): Promise<LegacyLibrary | SqliteLibrary> {
    if (this.storage() === "sqlite") return new SqliteLibrary(this.root);
    const { GitLibrary } = await import("./git-library");
    return new GitLibrary(this.root);
  }
  async initialize(options: { migrate?: boolean } = {}) {
    if (
      this.storage() === "git" &&
      (options.migrate || process.env.SHOWAI_SQLITE_MIGRATE === "1")
    ) {
      const { migrateGitContent } = await import("./content-migration");
      return migrateGitContent(this.root);
    }
    const manifest = await (await this.backend()).initialize();
    if (manifest.storage === "sqlite")
      await withLibraryLock(this.root, () =>
        retainActivatedGit(this.root, manifest),
      );
    return manifest;
  }
  async manifest() {
    return (await this.backend()).manifest();
  }
  async head() {
    return (await this.backend()).head();
  }
  async tree(revision?: string) {
    return (await this.backend()).tree(revision);
  }
  async readFiles(paths: string[], revision?: string) {
    return (await this.backend()).readFiles(paths, revision);
  }
  async readFile(path: string, revision?: string) {
    return (await this.backend()).readFile(path, revision);
  }
  async resourceRevision(path: string, revision?: string) {
    return (await this.backend()).resourceRevision(path, revision);
  }
  async history(input?: Parameters<LegacyLibrary["history"]>[0]) {
    return (await this.backend()).history(input);
  }
  async entryAt(revision: string) {
    return (await this.backend()).entryAt(revision);
  }
  async transaction<T>(context: ChangeContext, action: () => Promise<T>) {
    return (await this.backend()).transaction(context, action);
  }
  async stageFiles(
    changes: FileChanges,
    expected?: Map<string, string | null>,
  ) {
    return (await this.backend()).stageFiles(changes, expected);
  }
  async writeFiles(
    changes: FileChanges,
    context: ChangeContext,
    expected?: Map<string, string | null>,
  ) {
    return (await this.backend()).writeFiles(changes, context, expected);
  }
  async resolveWorkspaceConflict<T>(
    id: string,
    choice: "discard" | "import" | "merge",
    context: ChangeContext,
    apply?: (bytes: Buffer | null, conflict: WorkspaceConflict) => Promise<T>,
  ) {
    return (await this.backend()).resolveWorkspaceConflict(
      id,
      choice,
      context,
      apply,
    );
  }
  async recover() {
    return (await this.backend()).recover();
  }
  async restore(
    paths: string[],
    revision: string,
    context: ChangeContext,
    expected?: Map<string, string | null>,
  ) {
    return (await this.backend()).restore(paths, revision, context, expected);
  }
  async replayImported(
    entries: Parameters<LegacyLibrary["replayImported"]>[0],
    expectedHead: string | null,
  ) {
    return (await this.backend()).replayImported(entries, expectedHead);
  }
  async compact() {
    return (await this.backend()).compact();
  }
  async objectStatistics() {
    return (await this.backend()).objectStatistics();
  }
  async hasRevision(revision: string) {
    return (await this.backend()).hasRevision(revision);
  }
  async isAncestor(ancestor: string, revision: string) {
    return (await this.backend()).isAncestor(ancestor, revision);
  }
  async changedPaths(before: string, after: string) {
    return (await this.backend()).changedPaths(before, after);
  }
  async verify() {
    return (await this.backend()).verify();
  }
}

import { retargetBindings } from "../datasets/binding.mjs";
import { createHash } from "node:crypto";
import { FileStore, assertId } from "../core/store";
import {
  CoreError,
  type SidebarEntryMove,
  type SidebarOrganization,
} from "../core/model";
import { mutateLibrary } from "../core/library-runtime";
import { changeContext } from "../core/history-context";
import { canonicalJson } from "../core/diff";
import { LibraryOperations } from "../core/library-operations";
import { EditorDrafts, type EditorDraftInput } from "../core/editor-drafts";
import {
  importCompiledComponents,
  lockDocumentComponents,
  resolveDocumentComponents,
} from "../core/catalog";

/** Shared content organization, with the connection's project boundary checked before I/O. */
export class WorkspaceService {
  readonly store: FileStore;
  constructor(
    root: string,
    readonly projectId: string,
    readonly options: {
      libraryAccess?: boolean;
      projectIds?: string[];
    } = {},
  ) {
    this.store = new FileStore(root);
  }
  project(id = this.projectId) {
    assertId(id);
    if (
      this.options.projectIds
        ? !this.options.projectIds.includes(id)
        : !this.options.libraryAccess && id !== this.projectId
    )
      throw new CoreError(
        "INVALID_PATH",
        "This project is outside the connection's authorization.",
      );
    return id;
  }
  private mutate<T>(name: string, args: unknown, action: () => Promise<T>) {
    const context = changeContext();
    return mutateLibrary(this.store.root, action, {
      ...context,
      message: context.message ?? name,
      requestFingerprint: createHash("sha256")
        .update(
          canonicalJson({
            name,
            args,
            actor: context.actor,
            channel: context.channel,
          }),
        )
        .digest("hex"),
    });
  }
  folders(includeArchived = false) {
    return this.store.listFolders(this.project(), { includeArchived });
  }
  createFolder(input: Parameters<FileStore["createFolder"]>[1]) {
    const id = this.project();
    return this.mutate("Create folder", { id, input }, () =>
      this.store.createFolder(id, input),
    );
  }
  updateFolder(
    folderId: string,
    input: Parameters<FileStore["updateFolder"]>[2],
  ) {
    const id = this.project();
    return this.mutate("Update folder", { id, folderId, input }, () =>
      this.store.updateFolder(id, folderId, input),
    );
  }
  updateProject(input: Parameters<FileStore["updateProject"]>[1]) {
    const id = this.project();
    return this.mutate("Update project", { id, input }, () =>
      this.store.updateProject(id, input),
    );
  }
  sort(
    parentId: string | null,
    sortBy: Parameters<FileStore["setDirectorySort"]>[2],
  ) {
    const id = this.project();
    return this.mutate("Sort directory", { id, parentId, sortBy }, () =>
      this.store.setDirectorySort(id, parentId, sortBy),
    );
  }
  async moveEntry(input: Omit<SidebarEntryMove, "projectId">) {
    const source = this.project(),
      destination = this.project(input.destinationProjectId);
    const receipt = await this.mutate(
      "Move directory entry",
      { source, input },
      async () => {
        await this.store.arrangeEntry(
          { ...input, projectId: source },
          async (document) => {
            // Shared data stays in its project; bindings name it explicitly.
            document = retargetBindings(document, source, destination);
            const locked = await lockDocumentComponents(
              this.store.root,
              document,
              source,
            );
            const components = await resolveDocumentComponents(
              this.store.root,
              locked,
              source,
            );
            if (components.length)
              await importCompiledComponents(
                this.store.root,
                components,
                destination,
              );
            return lockDocumentComponents(this.store.root, locked, destination);
          },
        );
        return {
          sourceProjectId: source,
          destinationProjectId: destination,
        };
      },
    );
    return {
      ...receipt,
      ...(input.kind === "page"
        ? { page: await this.store.readPage(destination, input.id) }
        : {
            folder: (await this.store.listFolders(destination)).find(
              (folder) => folder.id === input.id,
            ),
          }),
    };
  }
  private requireSidebar() {
    this.project();
    if (!this.options.libraryAccess)
      throw new CoreError(
        "INVALID_PATH",
        "Sidebar groups require a library or authorized remote connection.",
      );
  }
  private filterSidebar(sidebar: SidebarOrganization) {
    if (!this.options.projectIds) return sidebar;
    const allowed = new Set(this.options.projectIds);
    const deniedGroups = new Set(
      Object.entries(sidebar.projectGroups)
        .filter(([id]) => !allowed.has(id))
        .map(([, group]) => group),
    );
    const projectGroups = Object.fromEntries(
      Object.entries(sidebar.projectGroups).filter(([id]) => allowed.has(id)),
    );
    return {
      groups: sidebar.groups.filter(
        (group) =>
          !deniedGroups.has(group.id) ||
          Object.values(projectGroups).includes(group.id),
      ),
      projectGroups,
      projectOrder: sidebar.projectOrder?.filter((id) => allowed.has(id)),
      entryOrder:
        sidebar.entryOrder &&
        Object.fromEntries(
          Object.entries(sidebar.entryOrder).filter(([id]) => allowed.has(id)),
        ),
    };
  }
  async sidebar() {
    this.requireSidebar();
    return this.filterSidebar(await this.store.readSidebar());
  }
  createGroup(name: string) {
    this.requireSidebar();
    return this.mutate("Create sidebar group", { name }, async () =>
      this.filterSidebar(await this.store.createProjectGroup(name)),
    );
  }
  async updateGroup(groupId: string, name: string | null) {
    this.requireSidebar();
    const sidebar = await this.store.readSidebar();
    for (const [project, group] of Object.entries(sidebar.projectGroups))
      if (group === groupId) this.project(project);
    if (!(await this.sidebar()).groups.some((group) => group.id === groupId))
      throw new CoreError(
        "NOT_FOUND",
        "Sidebar group not found in this connection.",
      );
    return this.mutate("Update sidebar group", { groupId, name }, async () =>
      this.filterSidebar(await this.store.updateProjectGroup(groupId, name)),
    );
  }
  moveProject(
    sectionId: string,
    relativeId?: string,
    placement: "before" | "after" = "before",
  ) {
    this.requireSidebar();
    const id = this.project();
    if (relativeId) this.project(relativeId);
    return this.mutate(
      "Arrange sidebar project",
      { id, sectionId, relativeId, placement },
      async () =>
        this.filterSidebar(
          await this.store.arrangeProject(id, sectionId, relativeId, placement),
        ),
    );
  }
  references(
    kind: string,
    id: string,
    input: { version?: string; integrity?: string },
  ) {
    return new LibraryOperations(this.store.root, this.project())
      .references(kind, id, input)
      .then((items) => ({ items }));
  }
  drafts(input: { clientId?: string; kind?: string; resourceId?: string }) {
    return new EditorDrafts(this.store.root).list({
      ...input,
      projectId: this.project(),
    });
  }
  private async draft(id: string) {
    const value = await new EditorDrafts(this.store.root).read(id);
    if (value.record.projectId !== this.project())
      throw new CoreError("INVALID_PATH", "Draft belongs to another project.");
    return value;
  }
  readDraft(id: string) {
    return this.draft(id);
  }
  saveDraft(input: Omit<EditorDraftInput, "projectId" | "actor">) {
    return new EditorDrafts(this.store.root).save({
      ...input,
      projectId: this.project(),
      actor: changeContext().actor,
    });
  }
  async removeDraft(id: string, generation: string) {
    const value = await this.draft(id);
    if (value.record.generation !== generation)
      throw new CoreError(
        "CONFLICT",
        "Draft generation changed. Read it again before discarding.",
      );
    await new EditorDrafts(this.store.root).remove(id, generation);
    // remove is generation-conditional; a simultaneous newer save must be reported.
    if ((await this.drafts({})).some((record) => record.id === id))
      throw new CoreError("CONFLICT", "A newer draft was retained.");
    return { id, removed: true };
  }
  async completeDraft(id: string, generation: string, revision: string) {
    await this.draft(id);
    const completed = await new EditorDrafts(this.store.root).completePage(
      id,
      generation,
      revision,
    );
    if (!completed)
      throw new CoreError(
        "CONFLICT",
        "Draft generation changed. The newer draft was retained.",
      );
    return { id, completed };
  }
}

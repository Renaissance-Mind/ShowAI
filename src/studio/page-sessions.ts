import type { DesktopChange } from "../desktop/bridge";
import {
  createPageSession,
  type PageSession,
  type PageSessionOptions,
} from "./page-session";
import type { SurfaceEditorState } from "../surface/SurfaceEditor";
import type { WorkspaceEditorState } from "../editor/workspace-editor";

export interface PageViewSession {
  key: string;
  tabId: string;
  session: PageSession;
  weight: number;
  surface: SurfaceEditorState;
  editors: WorkspaceEditorState;
}
export interface BackgroundPageIssue {
  projectId: string;
  pageId: string;
  title: string;
  error: string;
}
interface WorkspaceSnapshot {
  active: PageSession | null;
  activeView: string | null;
  views: readonly PageViewSession[];
  issues: readonly BackgroundPageIssue[];
  revision: number;
}

/** Views are bounded separately from documents; hidden pages keep their own save queue. */
export class PageSessions {
  home?: string;
  private pages = new Map<string, PageSession>();
  private viewStates = new Map<string, PageViewSession>();
  private listeners = new Set<() => void>();
  private stale = new Map<PageSession, number>();
  private changedComponents = new Set<PageSession>();
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private ticket = 0;
  private disposed = false;
  private dirty = false;
  private snapshot: WorkspaceSnapshot = {
    active: null,
    activeView: null,
    views: [],
    issues: [],
    revision: 0,
  };
  constructor(
    readonly options: PageSessionOptions & {
      maximumViews?: number;
      maximumViewBytes?: number;
    },
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<WorkspaceSnapshot> = {}) {
    if (this.disposed) return;
    const issues = [...new Set(this.pages.values())].flatMap((session) => {
      const state = session.getSnapshot();
      return state.error && state.draft && state.projectId
        ? [
            {
              projectId: state.projectId,
              pageId: state.draft.id,
              title: state.draft.title || "无标题",
              error: state.error,
            },
          ]
        : [];
    });
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      issues,
      revision: this.snapshot.revision + 1,
    };
    for (const listener of this.listeners) listener();
  }
  setHome(home: string) {
    if (this.home === home) return;
    if (
      [...new Set(this.pages.values())].some(
        (session) => session.isDirty() && !session.isDurable(),
      )
    )
      throw new Error("切换内容库前需要可靠保留所有页面草稿。");
    for (const session of new Set(this.pages.values())) session.dispose();
    this.pages.clear();
    this.viewStates.clear();
    this.stale.clear();
    this.changedComponents.clear();
    clearTimeout(this.refreshTimer);
    this.ticket++;
    this.home = home;
    this.publish({ active: null, activeView: null, views: [] });
  }
  private pageKey(projectId: string, pageId: string) {
    return JSON.stringify([projectId, pageId]);
  }
  private weight(session: PageSession) {
    const state = session.getSnapshot();
    return (
      2 *
      (JSON.stringify(state.draft).length +
        (state.record?.components.reduce(
          (bytes, component) => bytes + component.html.length,
          0,
        ) ?? 0))
    );
  }
  private retainView(session: PageSession, tabId: string) {
    const state = session.getSnapshot();
    const key = JSON.stringify([tabId, state.projectId, state.draft?.id]);
    const existing = this.viewStates.get(key);
    const view: PageViewSession = existing
      ? { ...existing, session }
      : {
          key,
          tabId,
          session,
          weight: this.weight(session),
          surface: {},
          editors: { cursors: new Map() },
        };
    this.viewStates.delete(key);
    this.viewStates.set(key, view);
    // Recency belongs to the cache map, not DOM order. Moving a retained iframe
    // within its parent recreates its browsing context even when React keeps the node.
    const views = this.snapshot.views.some((item) => item.key === key)
      ? this.snapshot.views.map((item) => (item.key === key ? view : item))
      : [...this.snapshot.views, view];
    const limit = this.options.maximumViews ?? 4;
    const budget = this.options.maximumViewBytes ?? 64 * 1024 * 1024;
    while (
      views.length > 1 &&
      (views.length > limit ||
        views.reduce((bytes, item) => bytes + item.weight, 0) > budget)
    ) {
      const oldest = [...this.viewStates.keys()].find(
        (candidate) =>
          candidate !== key && views.some((view) => view.key === candidate),
      );
      const index = views.findIndex((item) => item.key === oldest);
      if (index < 0) break;
      views.splice(index, 1);
    }
    this.publish({ active: session, activeView: key, views });
    const retainedBytes = () =>
      [...this.viewStates.values()].reduce(
        (bytes, item) =>
          bytes +
          item.weight *
            (1 +
              (item.surface.history?.past.length ?? 0) +
              (item.surface.history?.future.length ?? 0)),
        0,
      );
    for (const [key, item] of this.viewStates) {
      if (this.viewStates.size <= 12 && retainedBytes() <= budget) break;
      if (views.some((view) => view.key === item.key)) continue;
      this.viewStates.delete(key);
    }
    this.trimDocuments();
  }
  private trimDocuments() {
    const visible = new Set(this.snapshot.views.map((view) => view.session));
    if (this.snapshot.active) visible.add(this.snapshot.active);
    for (const [key, session] of this.pages) {
      if (this.pages.size <= 12) break;
      if (visible.has(session) || session.isDirty() || session.isBusy())
        continue;
      this.pages.delete(key);
      this.stale.delete(session);
      this.changedComponents.delete(session);
      session.dispose();
    }
  }
  async open(projectId: string, pageId: string, tabId = "primary") {
    if (!this.home) {
      const info = await this.options.invoke<{ home: string }>("app:info");
      this.setHome(info.home);
    }
    const ticket = ++this.ticket;
    const previous = this.snapshot.active;
    if (previous && !(await previous.leave())) return false;
    if (ticket !== this.ticket) return false;
    const key = this.pageKey(projectId, pageId);
    let session = this.pages.get(key);
    if (session && session.getSnapshot().draft?.id !== pageId) {
      this.pages.delete(key);
      session = undefined;
    }
    if (!session) {
      const home = this.home;
      session = createPageSession({
        ...this.options,
        invoke: (action, args) =>
          this.options.invoke(action, { ...args, expectedHome: home }),
      });
      const created = session;
      this.pages.set(key, created);
      created.subscribeMetadata(() => {
        const state = created.getSnapshot();
        if (state.draft && state.projectId && state.draft.id !== pageId) {
          if (this.pages.get(key) === created) this.pages.delete(key);
          this.pages.set(
            this.pageKey(state.projectId, state.draft.id),
            created,
          );
        }
        const dirty = this.isDirty();
        const changedDirty = this.dirty !== dirty;
        this.dirty = dirty;
        if (
          this.snapshot.active === created ||
          state.error ||
          changedDirty ||
          this.snapshot.issues.some((issue) => issue.pageId === state.draft?.id)
        )
          this.publish();
        this.trimDocuments();
      });
      if (!(await created.open(projectId, pageId))) return false;
    }
    if (ticket !== this.ticket) return false;
    this.retainView(session, tabId);
    if (this.stale.has(session)) void this.refresh(session);
    return true;
  }
  async leave() {
    return this.snapshot.active ? this.snapshot.active.leave() : true;
  }
  async clear() {
    const ticket = ++this.ticket;
    if (!(await this.leave()) || ticket !== this.ticket) return false;
    this.publish({ active: null, activeView: null });
    return true;
  }
  async flushAll() {
    const results = await Promise.all(
      [...new Set(this.pages.values())].map((session) => session.flush()),
    );
    return results.every(Boolean);
  }
  async prepareClose() {
    // The close boundary needs a durable recovery record, not a free writer
    // lease. A blocked formal save must not hold the window open indefinitely.
    const retained = await Promise.all(
      [...new Set(this.pages.values())].map((session) => session.leave()),
    );
    return retained.every(Boolean);
  }
  hasUnretainedChanges() {
    return [...new Set(this.pages.values())].some(
      (session) => session.isDirty() && !session.isDurable(),
    );
  }
  async refresh(session = this.snapshot.active) {
    if (!session) return;
    const generation = this.stale.get(session);
    const components = this.changedComponents.has(session);
    await session.refresh(components);
    if (generation === this.stale.get(session)) {
      this.stale.delete(session);
      this.changedComponents.delete(session);
    }
  }
  invalidate(change: DesktopChange) {
    if (change.home && this.home && change.home !== this.home) return;
    for (const session of new Set(this.pages.values())) {
      const state = session.getSnapshot();
      if (
        !change.all &&
        change.type !== "home" &&
        !change.catalog &&
        !(
          change.allPages && change.projectIds?.includes(state.projectId ?? "")
        ) &&
        change.pageIds &&
        !change.pageIds.includes(state.draft?.id ?? "")
      )
        continue;
      this.stale.set(session, (this.stale.get(session) ?? 0) + 1);
      if (change.catalog) this.changedComponents.add(session);
    }
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      if (this.snapshot.active && this.stale.has(this.snapshot.active))
        void this.refresh();
    }, 40);
  }
  async closeTab(tabId: string) {
    const closing = this.snapshot.views.filter((view) => view.tabId === tabId);
    if (
      !(await Promise.all(closing.map((view) => view.session.leave()))).every(
        Boolean,
      )
    )
      return false;
    this.publish({
      views: this.snapshot.views.filter((view) => view.tabId !== tabId),
    });
    for (const [key, view] of this.viewStates)
      if (view.tabId === tabId) this.viewStates.delete(key);
    return true;
  }
  isDirty() {
    return [...new Set(this.pages.values())].some(
      (session) => session.isDirty() || session.isBusy(),
    );
  }
  async shutdown() {
    await Promise.all(
      [...new Set(this.pages.values())].map((session) => session.leave()),
    );
    this.disposed = true;
    clearTimeout(this.refreshTimer);
    for (const session of new Set(this.pages.values())) session.dispose();
    this.pages.clear();
    this.viewStates.clear();
    this.listeners.clear();
  }
}

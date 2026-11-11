import {
  Activity,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useCallback,
  type ReactNode,
} from "react";
import {
  PageLinkContext,
  type LinkablePage,
  type PageLinkBridge,
  type RecordPeekRequest,
  type RecordPeekState,
} from "../components/page-links";
import { CustomComponentsProvider } from "../components/custom/CustomBlock";
import {
  WorkspaceEditorContext,
  WorkspaceEditors,
} from "../editor/workspace-editor";
import { EditorViewScope } from "../editor/view-scope";
import SurfaceEditor from "../surface/SurfaceEditor";
import type { EditorControls } from "../surface/EditorControls";
import type { PageSessions, PageViewSession } from "./page-sessions";
import { PAGE_PREVIEW_TAB } from "./page-sessions";
import PageHeading from "./PageHeading";
import PageBacklinks from "./PageBacklinks";
import { PageReferenceContext } from "../components/page-references";
import { workbenchReferenceSource } from "./page-references";
import { DatasetScope } from "../datasets/react";
import { ReaderStateContext, readerStateStore } from "../surface/reader-state";
import {
  MountQueue,
  MountQueueContext,
} from "../components/blocks/mount-queue";

const noPages: LinkablePage[] = [];
function PageContent({
  view,
  readOnly,
  revealId,
  onControlsChange,
  onActiveSurfaceChange,
  onRevealHandled,
  onEditIcon,
  linkablePages,
  onCopyLink,
  onCreateLinkedPage,
  onRenameLinkedPage,
  onOpenRecord,
  onCloseRecord,
  recordPeek,
  headerAddon,
}: {
  view: PageViewSession;
  readOnly?: boolean;
  revealId?: string | null;
  onControlsChange: (controls: EditorControls | null) => void;
  onActiveSurfaceChange: (id: string) => void;
  onRevealHandled: () => void;
  onEditIcon: () => void;
  /** Loaded pages of each project, offered as link targets. */
  linkablePages: Record<string, { pages: LinkablePage[] } | undefined>;
  onCopyLink: (target: {
    projectId: string;
    pageId: string;
    blockIds: string[];
  }) => void;
  /** Creates a page for a component on this page, such as a database record. */
  onCreateLinkedPage?: (input: {
    projectId: string;
    hostPageId: string;
    title?: string;
    folderId?: string;
    folderName: string;
  }) => Promise<{ pageId: string; folderId: string }>;
  /** Renames a page for a component on this page, such as a database record. */
  onRenameLinkedPage?: (input: {
    projectId: string;
    pageId: string;
    title: string;
  }) => Promise<void>;
  onOpenRecord?: (
    request: RecordPeekRequest & {
      hostProjectId: string;
      hostPageId: string;
    },
  ) => void;
  onCloseRecord?: (sourceId: string) => void;
  recordPeek?: RecordPeekState;
  headerAddon?: ReactNode;
}) {
  const state = useSyncExternalStore(
    view.session.subscribe,
    view.session.getSnapshot,
    view.session.getSnapshot,
  );
  const projectId = state.projectId;
  const pageId = state.draft?.id;
  const pages =
    (projectId ? linkablePages[projectId]?.pages : undefined) ?? noPages;
  // Each save lists the project's pages again. The bridge reads the list
  // through a getter so its identity, and every component's environment,
  // survives saves; components that show the list subscribe.
  const latestPages = useRef(pages);
  latestPages.current = pages;
  const pageListeners = useRef(new Set<() => void>());
  const subscribePages = useCallback((listener: () => void) => {
    pageListeners.current.add(listener);
    return () => {
      pageListeners.current.delete(listener);
    };
  }, []);
  useLayoutEffect(() => {
    for (const listener of pageListeners.current) listener();
  }, [pages]);
  const latestCopy = useRef(onCopyLink);
  latestCopy.current = onCopyLink;
  const latestCreate = useRef(onCreateLinkedPage);
  latestCreate.current = onCreateLinkedPage;
  const latestRename = useRef(onRenameLinkedPage);
  latestRename.current = onRenameLinkedPage;
  const latestOpen = useRef(onOpenRecord);
  latestOpen.current = onOpenRecord;
  const latestClose = useRef(onCloseRecord);
  latestClose.current = onCloseRecord;
  const pageActions = useMemo<Omit<
    PageLinkBridge,
    "pages" | "recordPeek"
  > | null>(
    () =>
      projectId && pageId
        ? {
            projectId,
            pageId,
            copyLink: (blockIds) =>
              latestCopy.current({ projectId, pageId, blockIds }),
            ...(latestCreate.current
              ? {
                  createPage: (input: {
                    title?: string;
                    folderId?: string;
                    folderName: string;
                  }) =>
                    latestCreate.current!({
                      ...input,
                      projectId,
                      hostPageId: pageId,
                    }),
                }
              : {}),
            ...(latestRename.current
              ? {
                  renamePage: (target: string, title: string) =>
                    latestRename.current!({
                      projectId,
                      pageId: target,
                      title,
                    }),
                }
              : {}),
            ...(latestOpen.current
              ? {
                  openRecord: (request: RecordPeekRequest) =>
                    latestOpen.current!({
                      ...request,
                      hostProjectId: projectId,
                      hostPageId: pageId,
                    }),
                  closeRecord: (sourceId: string) =>
                    latestClose.current?.(sourceId),
                }
              : {}),
          }
        : null,
    [projectId, pageId],
  );
  const pageLinks = useMemo<PageLinkBridge | null>(
    () =>
      pageActions
        ? {
            ...pageActions,
            get pages() {
              return latestPages.current;
            },
            subscribePages,
            ...(recordPeek ? { recordPeek } : {}),
          }
        : null,
    [pageActions, subscribePages, recordPeek],
  );
  const references = useMemo(
    () =>
      projectId && pageId
        ? workbenchReferenceSource({ projectId, pageId }, subscribePages)
        : null,
    [projectId, pageId, subscribePages],
  );
  const readerState = useMemo(
    () =>
      projectId && pageId
        ? { page: `${projectId}/${pageId}`, store: readerStateStore() }
        : null,
    [projectId, pageId],
  );
  const editors = useContext(WorkspaceEditorContext);
  useLayoutEffect(() => {
    // A page opened from a sidebar or directory row leaves focus on that row,
    // so its F2 and Delete keep acting on the row.
    const restore = () => {
      if (!document.activeElement?.closest("[data-library-id]"))
        editors?.restoreFocus();
    };
    restore();
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [editors, view.key]);
  if (!state.draft) return null;
  const locked = !!readOnly || !!state.record?.readOnly;
  return (
    <PageLinkContext.Provider value={pageLinks}>
      <PageReferenceContext.Provider value={references}>
        <CustomComponentsProvider components={state.record?.components ?? []}>
          <DatasetScope
            projectId={state.projectId}
            pageId={state.draft.id}
            readOnly={locked}
          >
            <ReaderStateContext.Provider value={readerState}>
              <SurfaceEditor
                key={`${state.draft.id}:${state.renderVersion}`}
                document={state.draft}
                readOnly={locked}
                onChange={view.session.edit}
                header={
                  state.draft.content.attrs?.kind === "board" ? undefined : (
                    <>
                      <PageHeading
                        title={state.draft.title}
                        icon={state.draft.icon}
                        readOnly={locked}
                        onTitleChange={(title) => view.session.edit({ title })}
                        onEditIcon={onEditIcon}
                      />
                      <PageBacklinks />
                      {headerAddon}
                    </>
                  )
                }
                revealId={revealId}
                onControlsChange={onControlsChange}
                onActiveSurfaceChange={onActiveSurfaceChange}
                onRevealHandled={onRevealHandled}
                retainedState={view.surface}
                inlineInkProjectId={state.projectId ?? undefined}
                onInkSave={view.session.flush}
                onPublishedInkSave={view.session.flushPublishedSource}
              />
            </ReaderStateContext.Provider>
          </DatasetScope>
        </CustomComponentsProvider>
      </PageReferenceContext.Provider>
    </PageLinkContext.Provider>
  );
}

const PageView = memo(function PageView({
  view,
  active,
  ...props
}: React.ComponentProps<typeof PageContent> & { active: boolean }) {
  const [editors] = useState(() => new WorkspaceEditors(view.editors));
  const [queue] = useState(() => new MountQueue());
  const mounts = useRef(0);
  useEffect(() => {
    const generation = ++mounts.current;
    return () => {
      queueMicrotask(() => {
        if (mounts.current === generation) {
          editors.dispose();
          queue.dispose();
        }
      });
    };
  }, [editors, queue]);
  useEffect(() => {
    const print = () => queue.flush();
    window.addEventListener("beforeprint", print);
    return () => window.removeEventListener("beforeprint", print);
  }, [queue]);
  return (
    <EditorViewScope.Provider value={view.key}>
      <WorkspaceEditorContext.Provider value={editors}>
        <MountQueueContext.Provider value={queue}>
          <Activity mode={active ? "visible" : "hidden"}>
            <PageContent {...props} view={view} />
          </Activity>
        </MountQueueContext.Provider>
      </WorkspaceEditorContext.Provider>
    </EditorViewScope.Provider>
  );
});

/**
 * Hidden views keep their state and disconnect global effects and observers.
 * Views render only when their own data changes, not with every workbench render.
 */
export function PageWorkspace({
  sessions,
  visible,
  readOnly,
  revealId,
  linkablePages,
  preview = false,
  recordPeek,
  headerAddon,
  ...callbacks
}: {
  sessions: PageSessions;
  visible: boolean;
  preview?: boolean;
} & Omit<React.ComponentProps<typeof PageContent>, "view">) {
  const workspace = useSyncExternalStore(
    sessions.subscribe,
    sessions.getSnapshot,
    sessions.getSnapshot,
  );
  const latest = useRef(callbacks);
  latest.current = callbacks;
  const [stable] = useState(() => ({
    onControlsChange: (controls: EditorControls | null) =>
      latest.current.onControlsChange(controls),
    onActiveSurfaceChange: (id: string) =>
      latest.current.onActiveSurfaceChange(id),
    onRevealHandled: () => latest.current.onRevealHandled(),
    onEditIcon: () => latest.current.onEditIcon(),
    onCopyLink: (target: {
      projectId: string;
      pageId: string;
      blockIds: string[];
    }) => latest.current.onCopyLink(target),
    onCreateLinkedPage: (input: {
      projectId: string;
      hostPageId: string;
      title?: string;
      folderId?: string;
      folderName: string;
    }) => {
      if (!latest.current.onCreateLinkedPage)
        throw new Error("This workbench cannot create pages.");
      return latest.current.onCreateLinkedPage(input);
    },
    onRenameLinkedPage: (input: {
      projectId: string;
      pageId: string;
      title: string;
    }) => {
      if (!latest.current.onRenameLinkedPage)
        throw new Error("This workbench cannot rename pages.");
      return latest.current.onRenameLinkedPage(input);
    },
    onCloseRecord: (sourceId: string) =>
      latest.current.onCloseRecord?.(sourceId),
    onOpenRecord: callbacks.onOpenRecord
      ? (
          request: RecordPeekRequest & {
            hostProjectId: string;
            hostPageId: string;
          },
        ) => latest.current.onOpenRecord?.(request)
      : undefined,
  }));
  return workspace.views
    .filter((view) =>
      preview
        ? view.key === workspace.previewView
        : view.tabId !== PAGE_PREVIEW_TAB,
    )
    .map((view) => {
      const active =
        visible &&
        view.key === (preview ? workspace.previewView : workspace.activeView);
      return (
        <PageView
          key={`${view.key}:${view.session.id}:${view.session.getSnapshot().renderVersion}:${view.session.getSnapshot().draft?.id}`}
          view={view}
          active={active}
          readOnly={readOnly}
          revealId={active ? revealId : null}
          linkablePages={linkablePages}
          recordPeek={recordPeek}
          headerAddon={headerAddon}
          {...stable}
        />
      );
    });
}

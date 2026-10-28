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
} from "react";
import {
  PageLinkContext,
  type LinkablePage,
  type PageLinkBridge,
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
import PageHeading from "./PageHeading";
import { DatasetScope } from "../datasets/react";
import { ReaderStateContext, readerStateStore } from "../surface/reader-state";
import {
  MountQueue,
  MountQueueContext,
} from "../components/blocks/mount-queue";

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
}) {
  const state = useSyncExternalStore(
    view.session.subscribe,
    view.session.getSnapshot,
    view.session.getSnapshot,
  );
  const projectId = state.projectId;
  const pageId = state.draft?.id;
  const pages = projectId ? linkablePages[projectId]?.pages : undefined;
  const latestCopy = useRef(onCopyLink);
  latestCopy.current = onCopyLink;
  const pageLinks = useMemo<PageLinkBridge | null>(
    () =>
      projectId && pageId
        ? {
            projectId,
            pageId,
            pages: pages ?? [],
            copyLink: (blockIds) =>
              latestCopy.current({ projectId, pageId, blockIds }),
          }
        : null,
    [projectId, pageId, pages],
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
    editors?.restoreFocus();
    const frame = requestAnimationFrame(() => editors?.restoreFocus());
    return () => cancelAnimationFrame(frame);
  }, [editors, view.key]);
  if (!state.draft) return null;
  const locked = !!readOnly || !!state.record?.readOnly;
  return (
    <PageLinkContext.Provider value={pageLinks}>
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
                  <PageHeading
                    title={state.draft.title}
                    icon={state.draft.icon}
                    readOnly={locked}
                    onTitleChange={(title) => view.session.edit({ title })}
                    onEditIcon={onEditIcon}
                  />
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
  ...callbacks
}: {
  sessions: PageSessions;
  visible: boolean;
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
  }));
  return workspace.views.map((view) => {
    const active = visible && view.key === workspace.activeView;
    return (
      <PageView
        key={`${view.key}:${view.session.id}:${view.session.getSnapshot().renderVersion}:${view.session.getSnapshot().draft?.id}`}
        view={view}
        active={active}
        readOnly={readOnly}
        revealId={active ? revealId : null}
        linkablePages={linkablePages}
        {...stable}
      />
    );
  });
}

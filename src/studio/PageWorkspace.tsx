import {
  Activity,
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
        </DatasetScope>
      </CustomComponentsProvider>
    </PageLinkContext.Provider>
  );
}

function PageView({
  view,
  active,
  ...props
}: React.ComponentProps<typeof PageContent> & { active: boolean }) {
  const [editors] = useState(() => new WorkspaceEditors(view.editors));
  const mounts = useRef(0);
  useEffect(() => {
    const generation = ++mounts.current;
    return () => {
      queueMicrotask(() => {
        if (mounts.current === generation) editors.dispose();
      });
    };
  }, [editors]);
  return (
    <EditorViewScope.Provider value={view.key}>
      <WorkspaceEditorContext.Provider value={editors}>
        <Activity mode={active ? "visible" : "hidden"}>
          <PageContent {...props} view={view} />
        </Activity>
      </WorkspaceEditorContext.Provider>
    </EditorViewScope.Provider>
  );
}

/** Hidden views keep their state and disconnect global effects and observers. */
export function PageWorkspace({
  sessions,
  visible,
  ...props
}: {
  sessions: PageSessions;
  visible: boolean;
} & Omit<React.ComponentProps<typeof PageContent>, "view">) {
  const workspace = useSyncExternalStore(
    sessions.subscribe,
    sessions.getSnapshot,
    sessions.getSnapshot,
  );
  return workspace.views.map((view) => (
    <PageView
      key={`${view.key}:${view.session.id}:${view.session.getSnapshot().renderVersion}:${view.session.getSnapshot().draft?.id}`}
      view={view}
      active={visible && view.key === workspace.activeView}
      {...props}
    />
  ));
}

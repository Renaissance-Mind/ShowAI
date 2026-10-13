import {
  Activity,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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

function PageContent({
  view,
  readOnly,
  revealId,
  onControlsChange,
  onActiveSurfaceChange,
  onRevealHandled,
  onEditIcon,
}: {
  view: PageViewSession;
  readOnly?: boolean;
  revealId?: string | null;
  onControlsChange: (controls: EditorControls | null) => void;
  onActiveSurfaceChange: (id: string) => void;
  onRevealHandled: () => void;
  onEditIcon: () => void;
}) {
  const state = useSyncExternalStore(
    view.session.subscribe,
    view.session.getSnapshot,
    view.session.getSnapshot,
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
    <CustomComponentsProvider components={state.record?.components ?? []}>
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
        onHandwriting={window.showai?.handwrite && !locked ? async (boardId, document) => {
          view.session.edit(document);
          if (!(await view.session.flush())) return;
          const current = view.session.getSnapshot();
          if (!current.projectId || !current.draft) return;
          const updated = await window.showai!.handwrite!({ projectId: current.projectId, pageId: current.draft.id, boardId });
          view.session.edit(updated);
          await view.session.flush();
        } : undefined}
      />
    </CustomComponentsProvider>
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

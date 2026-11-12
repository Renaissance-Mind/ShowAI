import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import type { DesktopInfo } from "../../host/protocol";
import type { EditorControls } from "../../surface/EditorControls";
import type { ProjectSyncRequest } from "../SyncSettings";
import type { FeedbackRequest } from "../feedback/AboutFeedback";
import type { SettingsSection } from "../Settings";
import type { workbenchCapabilities } from "../capabilities";
import { useBuiltinDocTitle } from "../BuiltinDocs";
import type { View } from "./types";

/**
 * Where the workbench is: the view, the selected project and folder, the open
 * documentation page, the search, and the settings section with its requests.
 */
export function useRouteState({
  info,
  capabilities,
}: {
  info: DesktopInfo | null;
  capabilities: ReturnType<typeof workbenchCapabilities>;
}) {
  const receivingInvite = useRef(false);
  const [syncNavigationKey, setSyncNavigationKey] = useState(0);
  const [syncRequest, setSyncRequest] = useState<ProjectSyncRequest>();
  // 关于与反馈 opens on its report form or diagnostics preview on request.
  const [feedbackRequest, setFeedbackRequest] = useState<FeedbackRequest>();
  const feedbackRequestId = useRef(0);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [routing, setRouting] = useState(false);
  const routingRef = useRef(false);
  // Built-in documentation; the website workbench publishes its own instead.
  const [docPage, setDocPage] = useState<{ id: string; hash: string } | null>(
    null,
  );
  const docsAvailable = !!info && info.builtinDocs !== false;
  const showDocs = docsAvailable;
  const docTitle = useBuiltinDocTitle();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(location.search).has("invite")
      ? "settings"
      : "projects",
  );
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() =>
    new URLSearchParams(location.search).has("invite") ||
    !capabilities.manageLibrary
      ? "sync"
      : "general",
  );
  const [query, setQuery] = useState("");
  const [searchLibrary, setSearchLibrary] = useState(false);
  // Lists filter on the deferred query so typing stays responsive.
  const deferredQuery = useDeferredValue(query);
  // A history entry brings back the search it was left with; other view
  // changes start without one.
  const restoredSearch = useRef<{
    view: View;
    query: string;
    library: boolean;
  } | null>(null);
  useEffect(() => {
    const restored =
      restoredSearch.current?.view === view ? restoredSearch.current : null;
    restoredSearch.current = null;
    setSearchLibrary(restored?.library ?? false);
    setQuery(restored?.query ?? "");
  }, [view]);
  const [revealNode, setRevealNode] = useState<string | null>(null);
  const [editorControls, setEditorControls] = useState<EditorControls | null>(
    null,
  );
  const handleRevealHandled = useCallback(() => setRevealNode(null), []);
  const catalogScrollRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selectedProject);
  selectedRef.current = selectedProject;
  const selectedFolderRef = useRef(selectedFolder);
  selectedFolderRef.current = selectedFolder;
  return {
    receivingInvite,
    syncNavigationKey,
    setSyncNavigationKey,
    syncRequest,
    setSyncRequest,
    feedbackRequest,
    setFeedbackRequest,
    feedbackRequestId,
    workspaceReady,
    setWorkspaceReady,
    routing,
    setRouting,
    routingRef,
    docPage,
    setDocPage,
    showDocs,
    docTitle,
    selectedProject,
    setSelectedProject,
    selectedFolder,
    setSelectedFolder,
    view,
    setView,
    settingsSection,
    setSettingsSection,
    query,
    setQuery,
    searchLibrary,
    setSearchLibrary,
    deferredQuery,
    restoredSearch,
    revealNode,
    setRevealNode,
    editorControls,
    setEditorControls,
    handleRevealHandled,
    catalogScrollRef,
    selectedRef,
    selectedFolderRef,
  };
}

export type RouteState = ReturnType<typeof useRouteState>;

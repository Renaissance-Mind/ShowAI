import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { LinkablePage, PageLinkBridge } from "./rich-text/environment";

export type {
  LinkablePage,
  PageLinkBridge,
  RecordPeekTarget,
  RecordPeekRequest,
  RecordPeekState,
} from "./rich-text/environment";
/** Provided by the workbench around a saved page; absent in readers and exports. */
export const PageLinkContext = createContext<PageLinkBridge | null>(null);

const noSubscription = () => () => {};
/**
 * The page link bridge for components that display the page list: they
 * re-render when the host lists pages again. The context value itself keeps
 * its identity across saves, so other components are not re-rendered.
 */
export function usePageLinks(): PageLinkBridge | null {
  const bridge = useContext(PageLinkContext);
  const pages = useSyncExternalStore<LinkablePage[] | undefined>(
    bridge?.subscribePages ?? noSubscription,
    () => bridge?.pages,
    () => bridge?.pages,
  );
  return useMemo(
    () => (bridge && pages ? { ...bridge, pages } : bridge),
    [bridge, pages],
  );
}

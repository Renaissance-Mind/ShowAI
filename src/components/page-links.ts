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
export const PageLinkContext = createContext<PageLinkBridge | null>(null);

const noSubscription = () => () => {};
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

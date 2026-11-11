// References between pages, read through one public SDK call by built-in and
// custom components alike. The workbench answers from the live library
// index, a component frame asks its host page, and an exported page answers
// from the snapshot the export wrote for that page.

import { createContext, useContext, useEffect, useState } from "react";

/** One reference between two pages, as seen from the page that was asked about. */
export interface PageReferenceItem {
  /** The other page: the referring page for "to", the referenced page for "from". */
  projectId: string;
  pageId: string;
  title: string;
  icon?: string;
  /** The block on the referring page that holds the reference. */
  blockId: string | null;
  /** Blocks the reference points at on the referenced page. */
  blockIds: string[];
  kind: "link" | "database" | "component";
  /** Text around the reference. */
  snippet: string;
  /** "from" only: the referenced page is deleted or absent. */
  missing?: true;
}
export interface PageReferenceQuery {
  /** "to": pages referring to the page (backlinks). "from": pages it refers to. */
  direction?: "to" | "from";
  /** Another page; omitted means the page holding the component. */
  pageId?: string;
  projectId?: string;
}
export interface PageReferencesView {
  /** loading: asked. ready: items are current. unavailable: no index behind this view. */
  status: "loading" | "ready" | "unavailable";
  items: PageReferenceItem[];
  /** The page the items belong to, when known. */
  page?: { projectId: string; pageId: string };
  /** Why the host could not read the references. */
  error?: string;
}
/** The host answering reference queries around a page. */
export interface PageReferenceSource {
  page: { projectId: string; pageId: string };
  read(query: {
    projectId: string;
    pageId: string;
    direction: "to" | "from";
  }): Promise<PageReferenceItem[] | null>;
  /** Calls the listener when references may have changed. */
  subscribe(listener: () => void): () => void;
}

export const PageReferenceContext = createContext<PageReferenceSource | null>(
  null,
);

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
/** Checks a query from component code; hosts never trust a frame either. */
export function readPageReferenceQuery(value: unknown): PageReferenceQuery {
  const query = (value ?? {}) as Record<string, unknown>;
  if (typeof query !== "object" || Array.isArray(query))
    throw new Error("usePageReferences takes {direction, pageId, projectId}.");
  for (const key of Object.keys(query))
    if (!["direction", "pageId", "projectId"].includes(key))
      throw new Error(`usePageReferences does not take ${key}.`);
  if (
    query.direction !== undefined &&
    query.direction !== "to" &&
    query.direction !== "from"
  )
    throw new Error('usePageReferences direction is "to" or "from".');
  for (const key of ["pageId", "projectId"] as const)
    if (
      query[key] !== undefined &&
      (typeof query[key] !== "string" || !ID.test(query[key] as string))
    )
      throw new Error(`usePageReferences ${key} must be a page ID.`);
  if (query.projectId !== undefined && query.pageId === undefined)
    throw new Error("usePageReferences projectId needs a pageId.");
  return query as PageReferenceQuery;
}

/** Resolves a query against the page holding the component. */
export function pageReferenceTarget(
  source: PageReferenceSource,
  query: PageReferenceQuery,
) {
  return {
    projectId: query.projectId ?? source.page.projectId,
    pageId: query.pageId ?? source.page.pageId,
    direction: query.direction ?? "to",
  } as const;
}

/** The channel of the component frame this code runs in, if any. */
function frameChannel(): string | undefined {
  if (typeof document === "undefined" || window.parent === window) return;
  const config = document.getElementById("showai-component-data")?.textContent;
  if (!config) return;
  const channel = (JSON.parse(config) as { channel?: unknown }).channel;
  return typeof channel === "string" ? channel : undefined;
}

let requests = 0;
function askHost(
  channel: string,
  query: PageReferenceQuery,
): Promise<Omit<PageReferencesView, "status"> & { status: "ready" | "unavailable" }> {
  const requestId = `references-${++requests}`;
  return new Promise((resolve) => {
    const finish = (view: Omit<PageReferencesView, "status"> & { status: "ready" | "unavailable" }) => {
      window.removeEventListener("message", receive);
      clearTimeout(timer);
      resolve(view);
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (
        event.source !== window.parent ||
        data?.channel !== channel ||
        data.type !== "showai:references" ||
        data.requestId !== requestId
      )
        return;
      finish(
        data.status === "ready" && Array.isArray(data.items)
          ? { status: "ready", items: data.items, page: data.page }
          : { status: "unavailable", items: [] },
      );
    };
    // A host page without an index never answers.
    const timer = setTimeout(
      () => finish({ status: "unavailable", items: [] }),
      10000,
    );
    window.addEventListener("message", receive);
    window.parent.postMessage(
      { channel, type: "showai:references", requestId, query },
      "*",
    );
  });
}

/**
 * Pages referring to a page ("to", backlinks) or referred to by it ("from"),
 * with the holding block and surrounding text. Without pageId it reads the
 * page holding the component. The result follows changes to the library.
 */
export function usePageReferences(
  query: PageReferenceQuery = {},
): PageReferencesView {
  const checked = readPageReferenceQuery(query);
  const source = useContext(PageReferenceContext);
  const key = JSON.stringify([
    checked.direction ?? "to",
    checked.pageId ?? null,
    checked.projectId ?? null,
  ]);
  const [view, setView] = useState<PageReferencesView>({
    status: "loading",
    items: [],
  });
  useEffect(() => {
    let current = true;
    const channel = frameChannel();
    if (channel) {
      const load = () =>
        void askHost(channel, checked).then(
          (next) => current && setView(next),
        );
      load();
      // The host tells the frame when references may have changed.
      const changed = (event: MessageEvent) => {
        if (
          event.source === window.parent &&
          event.data?.channel === channel &&
          event.data.type === "showai:references-changed"
        )
          load();
      };
      window.addEventListener("message", changed);
      return () => {
        current = false;
        window.removeEventListener("message", changed);
      };
    }
    if (!source) {
      setView({ status: "unavailable", items: [] });
      return;
    }
    const target = pageReferenceTarget(source, checked);
    const load = () =>
      void source.read(target).then((items) => {
        if (!current) return;
        setView(
          items
            ? {
                status: "ready",
                items,
                page: { projectId: target.projectId, pageId: target.pageId },
              }
            : { status: "unavailable", items: [] },
        );
      }, (error: unknown) => {
        if (current)
          setView({
            status: "unavailable",
            items: [],
            error: error instanceof Error ? error.message : String(error),
          });
      });
    load();
    const unsubscribe = source.subscribe(load);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [source, key]);
  return view;
}

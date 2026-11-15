import { createContext, useContext, useEffect, useState } from "react";

export interface PageReferenceItem {
  projectId: string;
  pageId: string;
  title: string;
  icon?: string;
  blockId: string | null;
  blockIds: string[];
  kind: "link" | "database" | "component";
  snippet: string;
  missing?: true;
}
export interface PageReferenceQuery {
  direction?: "to" | "from";
  pageId?: string;
  projectId?: string;
}
export interface PageReferencesView {
  status: "loading" | "ready" | "unavailable";
  items: PageReferenceItem[];
  pages: number;
  page?: { projectId: string; pageId: string };
  error?: string;
}
export interface PageReferenceSource {
  page: { projectId: string; pageId: string };
  read(query: {
    projectId: string;
    pageId: string;
    direction: "to" | "from";
  }): Promise<{ items: PageReferenceItem[]; pages: number } | null>;
  subscribe(listener: () => void): () => void;
}

export const PageReferenceContext = createContext<PageReferenceSource | null>(
  null,
);

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
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
          ? {
              status: "ready",
              items: data.items,
              pages:
                typeof data.pages === "number"
                  ? data.pages
                  : new Set(
                      data.items.map(
                        (item: PageReferenceItem) =>
                          `${item.projectId}/${item.pageId}`,
                      ),
                    ).size,
              page: data.page,
            }
          : { status: "unavailable", items: [], pages: 0 },
      );
    };
    const timer = setTimeout(
      () => finish({ status: "unavailable", items: [], pages: 0 }),
      10000,
    );
    window.addEventListener("message", receive);
    window.parent.postMessage(
      { channel, type: "showai:references", requestId, query },
      "*",
    );
  });
}

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
    pages: 0,
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
      setView({ status: "unavailable", items: [], pages: 0 });
      return;
    }
    const target = pageReferenceTarget(source, checked);
    const load = () =>
      void source.read(target).then((answer) => {
        if (!current) return;
        setView(
          answer
            ? {
                status: "ready",
                items: answer.items,
                pages: answer.pages,
                page: { projectId: target.projectId, pageId: target.pageId },
              }
            : { status: "unavailable", items: [], pages: 0 },
        );
      }, (error: unknown) => {
        if (current)
          setView({
            status: "unavailable",
            items: [],
            pages: 0,
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

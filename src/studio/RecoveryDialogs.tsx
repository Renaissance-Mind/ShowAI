import { latestRequest } from "../lib/latest-request";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { LibraryMenuPoint } from "./LibraryNavigation";
import { ArrowRight, FileText } from "../ui/icons";
import Dialog from "./Dialog";
import ConflictPagePreview from "./ConflictPagePreview";
import { desktop, errorMessage } from "./bridge";
import type { PageChange } from "../core/model";
import type { SearchResult } from "../core/library-index";
import type { ShowDocument } from "../types";
import "./recovery.css";
import { getLocale, type MessageKey } from "../i18n";
import { useTranslator } from "../i18n/react";
import recoveryMessages from "../i18n/messages/recovery";
import type { WorkspaceConflict } from "../core/workspace-conflicts";
import type { recoverExternalPackage } from "../core/package-recovery";
export type PackageRecoveryResult = Awaited<
  ReturnType<typeof recoverExternalPackage>
>;
export function WorkspaceConflictsDialog({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const t = useTranslator(recoveryMessages);
  const [items, setItems] = useState<WorkspaceConflict[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void desktop.invoke<WorkspaceConflict[]>("workspace:conflicts").then(
      (values) => {
        if (active) setItems(values);
      },
      (reason) => {
        if (active) setError(errorMessage(reason));
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return (
    <Dialog title={t("externalChangesTitle")} onClose={onClose} wide>
      <div className="history-search-results">
        <p>{t("externalChangesIntro")}</p>
        {error && (
          <p className="history-error" role="alert">
            {error}
          </p>
        )}
        {items.map((item) => (
          <button
            key={item.id}
            className="history-search-result"
            onClick={() => onSelect(item.id)}
          >
            <FileText size={18} />
            <span>
              <strong>{item.path.split("/").at(-1)}</strong>
              <small>{item.path}</small>
              <p>
                {time(item.observedAt)} ·{" "}
                {t(
                  (
                    {
                      modified: "kind.modified",
                      added: "kind.added",
                      deleted: "kind.deleted",
                    } as const
                  )[item.kind],
                )}
              </p>
            </span>
            <ArrowRight size={16} />
          </button>
        ))}
        {!items.length && !error && (
          <p className="history-empty">{t("noExternalChanges")}</p>
        )}
      </div>
    </Dialog>
  );
}

function time(value: string) {
  return new Intl.DateTimeFormat(getLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
function Value({ value }: { value: unknown }) {
  const t = useTranslator(recoveryMessages);
  if (typeof value === "string" && /^data:image\//.test(value))
    return (
      <img
        className="history-value-image"
        src={value}
        alt={t("changedImage")}
      />
    );
  if (value === undefined)
    return <span className="history-empty-value">{t("notSet")}</span>;
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <>
      <pre>{text.length > 8000 ? text.slice(0, 8000) + "\n…" : text}</pre>
      {text.length > 8000 && (
        <details>
          <summary>
            {t("viewFullContent", {
              count: text.length.toLocaleString(getLocale()),
            })}
          </summary>
          <pre>{text}</pre>
        </details>
      )}
    </>
  );
}
const fieldNames: Record<string, MessageKey<typeof recoveryMessages>> = {
  title: "field.title",
  icon: "field.icon",
  cover: "field.cover",
  favorite: "field.favorite",
  archived: "field.archived",
  parentId: "field.parentId",
  layout: "field.layout",
  views: "field.views",
  surfaceViews: "field.surfaceViews",
  attrs: "field.attrs",
  content: "field.content",
  type: "field.type",
};
export function ChangeList({ changes }: { changes: PageChange[] }) {
  const t = useTranslator(recoveryMessages);
  return (
    <div className="history-change-list">
      {changes.length ? (
        changes.map((change, index) => (
          <section key={index} className="history-change">
            <header>
              <strong>{t(`change.${change.type}`)}</strong>
              {"blockId" in change && (
                <code title={change.blockId}>
                  {change.blockId.slice(0, 12)}
                </code>
              )}
            </header>
            {"fields" in change ? (
              change.fields.map((field) => (
                <div className="history-field" key={field.field}>
                  <p>
                    {Object.hasOwn(fieldNames, field.field)
                      ? t(fieldNames[field.field])
                      : field.field}
                  </p>
                  <div className="history-value-pair">
                    <div className="before">
                      <small>{t("before")}</small>
                      <Value value={field.before} />
                    </div>
                    <div className="after">
                      <small>{t("after")}</small>
                      <Value value={field.after} />
                    </div>
                  </div>
                </div>
              ))
            ) : change.type === "block.moved" ? (
              <p>
                {change.parentId
                  ? change.afterId
                    ? t("movedIntoContainerAfter", {
                        parent: change.parentId.slice(0, 12),
                        after: change.afterId.slice(0, 12),
                      })
                    : t("movedIntoContainerStart", {
                        parent: change.parentId.slice(0, 12),
                      })
                  : change.afterId
                    ? t("movedToRootAfter", {
                        after: change.afterId.slice(0, 12),
                      })
                    : t("movedToRootStart")}
              </p>
            ) : (
              <details>
                <summary>{t("viewBlockContent")}</summary>
                <Value value={change.node} />
              </details>
            )}
          </section>
        ))
      ) : (
        <p className="history-empty">{t("samePageContent")}</p>
      )}
    </div>
  );
}

export function LibrarySearchResults({
  projectId,
  query,
  onOpen,
  onMenu,
}: {
  projectId?: string;
  query: string;
  onOpen: (
    result: SearchResult,
    event: MouseEvent<HTMLButtonElement>,
  ) => Promise<void>;
  onMenu: (
    result: SearchResult,
    anchor: HTMLElement,
    point?: LibraryMenuPoint,
  ) => void;
}) {
  const t = useTranslator(recoveryMessages);
  const [kind, setKind] = useState(""),
    [results, setResults] = useState<SearchResult[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [total, setTotal] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const request = useRef(0);
  const searchQueue =
    useRef(
      latestRequest<{
        items: SearchResult[];
        total: number;
        nextCursor: string | null;
      }>(),
    );
  const find = useCallback(
    async (next?: string) => {
      const ticket = ++request.current;
      if (!query.trim()) {
        setResults([]);
        setTotal(0);
        setCursor(null);
        setBusy(false);
        setError("");
        return;
      }
      setBusy(true);
      setError("");
      try {
        const result = await searchQueue.current(() =>
          desktop.invoke<{
            items: SearchResult[];
            total: number;
            nextCursor: string | null;
          }>("library:search", {
            projectId,
            query,
            kind: kind || undefined,
            cursor: next,
          }),
        );
        if (ticket !== request.current) return;
        setResults((current) =>
          next ? [...current, ...result.items] : result.items,
        );
        setCursor(result.nextCursor);
        setTotal(result.total);
      } catch (reason) {
        if (ticket === request.current) setError(errorMessage(reason));
      } finally {
        if (ticket === request.current) setBusy(false);
      }
    },
    [projectId, query, kind],
  );
  useEffect(() => {
    const timer = setTimeout(() => void find(), 180);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [find]);
  async function openResult(
    result: SearchResult,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    try {
      await onOpen(result, event);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }
  return (
    <section aria-label={t("searchResults")}>
      <div className="history-toolbar">
        <select
          aria-label={t("searchKind")}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="">{t("searchKind.all")}</option>
          <option value="page">{t("searchKind.page")}</option>
          <option value="component">{t("searchKind.component")}</option>
          <option value="template">{t("searchKind.template")}</option>
          <option value="source">{t("searchKind.source")}</option>
          <option value="project">{t("searchKind.project")}</option>
        </select>
      </div>
      {error && (
        <p className="history-error" role="alert">
          {error}
        </p>
      )}
      <div className="history-search-results">
        <p className="history-search-count">
          {busy
            ? t("searching")
            : query
              ? t("resultCount", { count: total })
              : t("typeToSearch")}
        </p>
        {results.map((result) => {
          const page = result.path.match(
            /^projects\/([^/]+)\/pages\/([^/]+)\.json$/,
          );
          return (
            <button
              key={result.id}
              className="history-search-result"
              onClick={(event) => void openResult(result, event)}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                void openResult(result, event);
              }}
              onContextMenu={(event) => {
                if (!page && result.kind !== "project") return;
                event.preventDefault();
                onMenu(result, event.currentTarget, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              onKeyDown={(event) => {
                if (
                  (!page && result.kind !== "project") ||
                  (event.key !== "ContextMenu" &&
                    !(event.shiftKey && event.key === "F10"))
                )
                  return;
                event.preventDefault();
                onMenu(result, event.currentTarget);
              }}
            >
              <FileText size={18} />
              <span>
                <small>
                  {result.location.join(" / ") || result.resourceId}
                </small>
                <strong>{result.title}</strong>
                <p>{result.snippet}</p>
                {!page && <code>{result.path}</code>}
              </span>
              <ArrowRight size={17} />
            </button>
          );
        })}
        {cursor && (
          <button
            className="studio-button"
            disabled={busy}
            onClick={() => void find(cursor)}
          >
            {t("moreResults")}
          </button>
        )}
      </div>
    </section>
  );
}

export function ExternalConflictDialog({
  id,
  onClose,
  onResolved,
  projectId,
  onPackageRecovered,
  saveFailure = false,
  draftDocument,
  onEdit,
}: {
  id: string;
  onClose: () => void;
  onResolved: () => Promise<void>;
  projectId?: string;
  onPackageRecovered: (result: PackageRecoveryResult) => Promise<void>;
  saveFailure?: boolean;
  draftDocument?: ShowDocument;
  onEdit?: (document: ShowDocument) => void;
}) {
  const t = useTranslator(recoveryMessages);
  const [detail, setDetail] = useState<{
      path: string;
      baseline: string | null;
      current: string | null;
      external: string | null;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [resolved, setResolved] = useState(""),
    [tab, setTab] = useState<"compare" | "merge">("compare");
  useEffect(() => {
    let active = true;
    void desktop
      .invoke<typeof detail>("workspace:conflict", { id })
      .then(
        (value) => {
          if (active && value) {
            setDetail(value);
            if (
              value.path.includes("/packages/") ||
              value.path.startsWith("packages/")
            )
              return;
            const artifact =
              draftDocument ??
              (value.external
                ? JSON.parse(value.external)
                : value.current
                  ? JSON.parse(value.current)
                  : {});
            setResolved(
              JSON.stringify(
                draftDocument ?? artifact.document ?? artifact,
                null,
                2,
              ),
            );
          }
        },
        (reason) => {
          if (active) setError(errorMessage(reason));
        },
      )
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [id, draftDocument]);
  const packageConflict =
    !!detail &&
    (detail.path.includes("/packages/") || detail.path.startsWith("packages/"));
  async function recoverPackage() {
    setBusy(true);
    setError("");
    try {
      const result = await desktop.invoke<PackageRecoveryResult>(
        "workspace:recoverPackage",
        {
          id,
          clientId: `external:${crypto.randomUUID()}`,
          targetProjectId: projectId,
        },
      );
      await onPackageRecovered(result);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function choose(resolution: "discard" | "import" | "merge") {
    setBusy(true);
    setError("");
    try {
      await desktop.invoke("workspace:resolve", {
        id,
        resolution,
        ...(resolution === "merge" ? { document: JSON.parse(resolved) } : {}),
      });
      await onResolved();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={saveFailure ? t("saveFailedExternal") : t("resolveExternalTitle")}
      dismissible={!saveFailure}
      onClose={onClose}
      wide
      className="history-external-dialog"
    >
      <div className="history-conflict-body">
        <p className="history-merge-summary">{t("externalKeptIntro")}</p>
        {error && (
          <p className="history-error" role="alert">
            {error}
          </p>
        )}
        {detail && (
          <>
            <nav className="history-tabs">
              <button
                aria-pressed={tab === "compare"}
                onClick={() => setTab("compare")}
              >
                {t("viewVersions")}
              </button>
              <button
                aria-pressed={tab === "merge"}
                onClick={() => setTab("merge")}
                disabled={packageConflict}
              >
                {t("editMergeResult")}
              </button>
            </nav>
            {tab === "compare" && saveFailure && draftDocument ? (
              <div className="history-conflict-values">
                <div>
                  <h3>{t("myUnsavedChanges")}</h3>
                  <ConflictPagePreview value={draftDocument} />
                </div>
                <div>
                  <h3>{t("currentFileVersion")}</h3>
                  <ConflictPagePreview value={detail.external} />
                </div>
              </div>
            ) : tab === "compare" ? (
              <div className="history-conflict-values">
                {draftDocument && (
                  <div>
                    <h3>{t("unsavedAppDraft")}</h3>
                    <Value value={draftDocument} />
                  </div>
                )}
                <div>
                  <h3>{t("originalBase")}</h3>
                  <Value value={detail.baseline} />
                </div>
                <div>
                  <h3>{t("savedVersion")}</h3>
                  <Value value={detail.current} />
                </div>
                <div>
                  <h3>{t("externalVersion")}</h3>
                  <Value value={detail.external} />
                </div>
              </div>
            ) : (
              <textarea
                aria-label={t("externalMergeResult")}
                className="history-resolution"
                value={resolved}
                onChange={(event) => setResolved(event.target.value)}
                spellCheck={false}
              />
            )}
          </>
        )}
      </div>
      {detail && (
        <footer className="history-footer">
          {saveFailure && draftDocument && onEdit && (
            <button
              className="studio-button primary"
              disabled={busy || packageConflict}
              onClick={() => {
                onEdit(JSON.parse(resolved));
                onClose();
              }}
            >
              {t("editAndResave")}
            </button>
          )}
          <button
            className="studio-button primary"
            disabled={busy}
            onClick={() =>
              packageConflict
                ? void recoverPackage()
                : void choose(tab === "merge" ? "merge" : "import")
            }
          >
            {packageConflict
              ? t("keepAsEditDraft")
              : tab === "merge"
                ? t("saveMergeResult")
                : saveFailure
                  ? t("discardMineUseFile")
                  : t("importExternal")}
          </button>
          <button
            className="studio-button"
            disabled={busy}
            onClick={() => void choose("discard")}
          >
            {t("useSavedVersion")}
          </button>
          {!saveFailure && (
            <button className="studio-text-button" onClick={onClose}>
              {t("later")}
            </button>
          )}
        </footer>
      )}
    </Dialog>
  );
}

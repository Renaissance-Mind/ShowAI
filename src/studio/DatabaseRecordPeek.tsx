import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { ArrowUp, ArrowDown, Maximize2, X } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/databasePeek";
import pageMessages from "../i18n/messages/pageSession";
import commonMessages from "../i18n/messages/common";
import { PageWorkspace } from "./PageWorkspace";
import type { useDatabaseRecordPeek } from "./useDatabaseRecordPeek";
import "./database-record-peek.css";

const ignore = () => {};
export default function DatabaseRecordPeek({
  peek,
  sessions,
  linkablePages,
  readOnly,
  report,
  onCopyLink,
  onCreateLinkedPage,
  onRenameLinkedPage,
  onEditIcon,
}: {
  peek: ReturnType<typeof useDatabaseRecordPeek>;
  sessions: ComponentProps<typeof PageWorkspace>["sessions"];
  linkablePages: ComponentProps<typeof PageWorkspace>["linkablePages"];
  readOnly?: boolean;
  report: (error: unknown) => void;
  onCopyLink: ComponentProps<typeof PageWorkspace>["onCopyLink"];
  onCreateLinkedPage: ComponentProps<
    typeof PageWorkspace
  >["onCreateLinkedPage"];
  onRenameLinkedPage: ComponentProps<
    typeof PageWorkspace
  >["onRenameLinkedPage"];
  onEditIcon: () => void;
}) {
  const view = peek.view!;
  const snapshot = useSyncExternalStore(
    view.session.subscribe,
    view.session.getSnapshot,
    view.session.getSnapshot,
  );
  const t = useTranslator(messages);
  const tp = useTranslator(pageMessages);
  const tc = useTranslator(commonMessages);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus({ preventScroll: true }), []);
  const run = (work: () => Promise<unknown>) => () => void work().catch(report);
  return (
    <aside
      className="database-record-peek"
      role="region"
      aria-label={t("preview")}
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          event.stopPropagation();
          void view.session.flush().catch(report);
        }
      }}
    >
      <header className="database-record-peek-toolbar">
        <button
          ref={close}
          type="button"
          className="studio-icon"
          aria-label={t("close")}
          title={`${t("close")} · Esc`}
          onClick={run(peek.close)}
        >
          <X size={17} />
        </button>
        <button
          type="button"
          className="studio-icon"
          aria-label={t("fullPage")}
          title={t("fullPage")}
          disabled={peek.busy}
          onClick={run(peek.expand)}
        >
          <Maximize2 size={16} />
        </button>
        <span className="database-record-peek-title">
          {snapshot.draft?.title || tc("untitled")}
        </span>
        <span
          className="database-record-peek-save"
          role="status"
          aria-live="polite"
        >
          {readOnly || snapshot.record?.readOnly
            ? t("readOnly")
            : tp(
                snapshot.error
                  ? "status.failed"
                  : snapshot.status === "saving"
                    ? "status.saving"
                    : snapshot.status === "retained"
                      ? "status.retained"
                      : snapshot.dirty
                        ? "status.changed"
                        : "status.saved",
              )}
        </span>
        {peek.index >= 0 && (
          <span
            className="database-record-peek-position"
            title={t("position", { index: peek.index + 1, count: peek.count })}
          >
            {peek.index + 1}/{peek.count}
          </span>
        )}
        <button
          type="button"
          className="studio-icon"
          aria-label={t("previous")}
          title={t("previous")}
          disabled={peek.busy || peek.index <= 0}
          onClick={() => peek.step(-1)}
        >
          <ArrowUp size={16} />
        </button>
        <button
          type="button"
          className="studio-icon"
          aria-label={t("next")}
          title={t("next")}
          disabled={peek.busy || peek.index < 0 || peek.index >= peek.count - 1}
          onClick={() => peek.step(1)}
        >
          <ArrowDown size={16} />
        </button>
      </header>
      {snapshot.error && (
        <div className="database-record-peek-notice" role="alert">
          <span>{snapshot.error}</span>
          <button
            type="button"
            disabled={peek.busy}
            onClick={run(() =>
              snapshot.status === "conflict"
                ? peek.expand()
                : view.session.retry(),
            )}
          >
            {t(snapshot.status === "conflict" ? "resolve" : "retry")}
          </button>
          {snapshot.status !== "conflict" && (
            <button type="button" onClick={run(peek.expand)}>
              {t("resolve")}
            </button>
          )}
        </div>
      )}
      {snapshot.draftNotice && (
        <p className="database-record-peek-notice" role="status">
          {snapshot.draftNotice}
        </p>
      )}
      {!!snapshot.availableDrafts.length && (
        <div className="database-record-peek-notice">
          {snapshot.availableDrafts.map((draft) => (
            <button
              key={draft.id}
              type="button"
              disabled={peek.busy || readOnly}
              onClick={run(() => view.session.recoverDraft(draft.id))}
            >
              {t("restore")} · {new Date(draft.savedAt).toLocaleString()}
            </button>
          ))}
        </div>
      )}
      <div className="database-record-peek-scroll">
        <PageWorkspace
          sessions={sessions}
          preview
          visible
          readOnly={readOnly}
          linkablePages={linkablePages}
          onControlsChange={ignore}
          onActiveSurfaceChange={ignore}
          onRevealHandled={ignore}
          onEditIcon={onEditIcon}
          onCopyLink={onCopyLink}
          onCreateLinkedPage={onCreateLinkedPage}
          onRenameLinkedPage={onRenameLinkedPage}
          headerAddon={
            <div
              ref={peek.setPropertiesHost}
              className="database-record-peek-properties"
              aria-label={t("properties")}
            />
          }
        />
      </div>
    </aside>
  );
}

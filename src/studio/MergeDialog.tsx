import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
} from "../ui/icons";
import Dialog from "./Dialog";
import { ChangeList } from "./RecoveryDialogs";
import ConflictPagePreview from "./ConflictPagePreview";
import { desktop, errorMessage } from "./bridge";
import { mergePageContent } from "../core/page-merge-model";
import type { MergeChoices } from "../core/catalog-merge";
import type { PageMergeConflict, PageMergePreview } from "../core/page-merge";
import type { ShowDocument } from "../types";
import { useTranslator } from "../i18n/react";
import recoveryMessages from "../i18n/messages/recovery";
import { conflictNodeLabel, conflictText } from "./conflict-content";
import "./merge-dialog.css";

const ConflictDiff = lazy(() => import("./ConflictDiff"));
type Preview = PageMergePreview & {
  currentRevision: string;
  currentHash: string;
  baseDocument: ShowDocument;
  currentDocument: ShowDocument;
};

export default function MergeDialog({
  projectId,
  pageId,
  baseRevision,
  document,
  onClose,
  onMerged,
  saveFailure = false,
  onEdit,
  onDiscard,
}: {
  projectId: string;
  pageId: string;
  baseRevision: string;
  document: ShowDocument;
  onClose: () => void;
  onMerged: () => Promise<void>;
  saveFailure?: boolean;
  onEdit?: (
    document: ShowDocument,
    currentRevision: string,
    currentHash: string,
  ) => void;
  onDiscard?: () => Promise<void>;
}) {
  const t = useTranslator(recoveryMessages);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<MergeChoices>({});
  const [activePath, setActivePath] = useState("");
  const [tab, setTab] = useState<"conflicts" | "result">("conflicts");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const detail = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    setPreview(null);
    setChoices({});
    setError("");
    void desktop
      .invoke<Preview>("page:mergePreview", {
        projectId,
        pageId,
        baseRevision,
        document,
      })
      .then(
        (value) => {
          if (!active) return;
          setPreview(value);
          setActivePath(value.conflicts[0]?.path ?? "");
          setTab(value.conflicts.length ? "conflicts" : "result");
        },
        (reason) => {
          if (active) setError(errorMessage(reason));
        },
      );
    return () => {
      active = false;
    };
  }, [projectId, pageId, baseRevision, document, refresh]);
  const result = useMemo(
    () =>
      preview
        ? mergePageContent(
            preview.baseDocument,
            document,
            preview.currentDocument,
            "merge",
            choices,
          )
        : null,
    [preview, document, choices],
  );
  const conflicts = useMemo(() => {
    const items = new Map(
      preview?.conflicts.map((conflict) => [conflict.path, conflict]),
    );
    for (const conflict of result?.conflicts ?? [])
      items.set(conflict.path, conflict);
    return [...items.values()];
  }, [preview, result]);
  const pending = new Set(result?.conflicts.map((conflict) => conflict.path));
  const activeIndex = Math.max(
    0,
    conflicts.findIndex((conflict) => conflict.path === activePath),
  );
  const conflict = conflicts[activeIndex];
  const remaining = result?.conflicts.length ?? 0;
  const completed = conflicts.length - remaining;
  const rawText = (value: unknown) =>
    value === undefined
      ? t("missingInVersion")
      : typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);
  const label = (item: PageMergeConflict) => {
    if (item.path === "/structure" || item.path === "/root")
      return t("wholePageStructure");
    if (item.path.endsWith("/order") || item.path.endsWith("/readingOrder"))
      return t("readingOrderConflict");
    const field = item.path.split("/").at(-1);
    const fieldKeys = {
      title: "field.title",
      icon: "field.icon",
      cover: "field.cover",
      favorite: "field.favorite",
      archived: "field.archived",
      parentId: "field.parentId",
    } as const;
    if (field && Object.hasOwn(fieldKeys, field))
      return t(fieldKeys[field as keyof typeof fieldKeys]);
    return (
      (preview &&
        conflictNodeLabel(item, [
          document,
          preview.currentDocument,
          preview.baseDocument,
        ])) ||
      t("contentConflict")
    );
  };
  const select = (path: string) => {
    setActivePath(path);
    setTab("conflicts");
    detail.current?.scrollTo(0, 0);
  };
  function choose(side: "ours" | "theirs") {
    if (!conflict) return;
    setChoices((current) => {
      if (conflict.path === "/structure") return { [conflict.path]: side };
      const next = { ...current };
      delete next["/structure"];
      return { ...next, [conflict.path]: side };
    });
    setError("");
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!preview || !result || remaining || busy) return;
    await run(async () => {
      await desktop.invoke("page:mergeSave", {
        projectId,
        pageId,
        baseRevision,
        currentRevision: preview.currentRevision,
        document: result.document,
      });
      await onMerged();
      onClose();
    });
  }
  const leftText = conflictText(conflict?.ours);
  const rightText = conflictText(conflict?.theirs);
  const readable =
    leftText !== null && rightText !== null && leftText !== rightText;
  const usingRaw = !readable;
  return (
    <Dialog
      title={t("resolveChanges")}
      dismissible={!saveFailure && !busy}
      onClose={onClose}
      wide
      className="history-merge-dialog conflict-workspace"
      initialFocus="container"
    >
      <div className="conflict-overview">
        <div className="conflict-page-title">
          <FileText size={17} />
          <strong>{document.title}</strong>
          <span>{t("draftPreserved")}</span>
        </div>
        {preview && (
          <div className="conflict-progress" aria-live="polite">
            <span className={remaining ? "" : "complete"}>
              {remaining
                ? t("remainingConflicts", { count: remaining })
                : t("readyToSave")}
            </span>
            <progress
              value={conflicts.length ? completed : 1}
              max={Math.max(conflicts.length, 1)}
              aria-label={t("resolutionProgress")}
            />
            <small>
              {completed} / {conflicts.length}
            </small>
          </div>
        )}
      </div>
      {error && (
        <div className="conflict-error" role="alert">
          <span>{error}</span>
          <button
            className="studio-button"
            disabled={busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t("refreshComparison")}
          </button>
        </div>
      )}
      {preview && result ? (
        <>
          <div className="conflict-workspace-body">
            <nav className="conflict-navigation" aria-label={t("conflictList")}>
              <div className="conflict-nav-heading">
                {t("needsReview")}
                <span>{conflicts.length}</span>
              </div>
              {conflicts.map((item, index) => (
                <button
                  key={item.path}
                  disabled={busy}
                  className={`conflict-nav-item ${tab === "conflicts" && activeIndex === index ? "active" : ""}`}
                  aria-current={
                    tab === "conflicts" && activeIndex === index
                      ? "true"
                      : undefined
                  }
                  onClick={() => select(item.path)}
                >
                  <span
                    className={`conflict-index ${pending.has(item.path) ? "" : "complete"}`}
                  >
                    {pending.has(item.path) ? (
                      String(index + 1).padStart(2, "0")
                    ) : (
                      <Check size={14} />
                    )}
                  </span>
                  <span>
                    <strong>{label(item)}</strong>
                    <small>
                      {pending.has(item.path)
                        ? t("awaitingChoice")
                        : t("resolvedChoice")}
                    </small>
                  </span>
                </button>
              ))}
              <button
                className={`conflict-result-link ${tab === "result" ? "active" : ""}`}
                aria-current={tab === "result" ? "true" : undefined}
                onClick={() => setTab("result")}
              >
                <FileText size={16} />
                {t("mergedPreview")}
                <ChevronRight size={14} />
              </button>
              <p className="conflict-nav-note">{t("independentChangesKept")}</p>
            </nav>
            <section
              className="conflict-detail"
              ref={detail}
              aria-label={
                tab === "result" ? t("mergedPreview") : t("currentConflict")
              }
            >
              {tab === "conflicts" && conflict ? (
                <>
                  <div className="conflict-detail-heading">
                    <div>
                      <span className="conflict-eyebrow">
                        {t("conflictPosition", {
                          current: activeIndex + 1,
                          total: conflicts.length,
                        })}
                      </span>
                      <h3>{label(conflict)}</h3>
                    </div>
                    <div className="conflict-stepper">
                      <button
                        className="studio-icon"
                        aria-label={t("previousConflict")}
                        disabled={activeIndex === 0 || busy}
                        onClick={() => select(conflicts[activeIndex - 1].path)}
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        className="studio-icon"
                        aria-label={t("nextConflict")}
                        disabled={activeIndex === conflicts.length - 1 || busy}
                        onClick={() => select(conflicts[activeIndex + 1].path)}
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  </div>
                  <p className="conflict-help">
                    {t(
                      conflict.path === "/structure"
                        ? "wholePageChoiceHelp"
                        : "chooseVersionHelp",
                    )}
                  </p>
                  <div className="conflict-version-actions">
                    {(["ours", "theirs"] as const).map((side) => (
                      <div
                        key={side}
                        className={`conflict-version ${side} ${(choices["/structure"] ?? choices[conflict.path]) === side ? "chosen" : ""}`}
                      >
                        <span>
                          <i />
                          <strong>{t(`side.${side}`)}</strong>
                        </span>
                        <button
                          disabled={busy}
                          aria-pressed={
                            (choices["/structure"] ??
                              choices[conflict.path]) === side
                          }
                          onClick={() => choose(side)}
                        >
                          {(choices["/structure"] ?? choices[conflict.path]) ===
                            side && <Check size={14} />}
                          {t(
                            (choices["/structure"] ??
                              choices[conflict.path]) === side
                              ? "versionSelected"
                              : conflict.path === "/structure"
                                ? "useWholePage"
                                : "useThisVersion",
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                  <Suspense
                    fallback={
                      <div className="conflict-loading">
                        <Loader2 className="studio-spin" size={18} />
                        {t("loadingComparison")}
                      </div>
                    }
                  >
                    <ConflictDiff
                      key={`${conflict.path}:${usingRaw}`}
                      left={usingRaw ? rawText(conflict.ours) : leftText!}
                      right={usingRaw ? rawText(conflict.theirs) : rightText!}
                      leftLabel={t("side.ours")}
                      rightLabel={t("side.theirs")}
                    />
                  </Suspense>
                  <div className="conflict-comparison-tools">
                    <span>
                      {t(usingRaw ? "structuredComparison" : "textComparison")}
                    </span>
                  </div>
                  <section className="conflict-base" key={conflict.path}>
                    <h4>{t("commonVersion")}</h4>
                    <pre>
                      {conflictText(conflict.base) ?? rawText(conflict.base)}
                    </pre>
                  </section>
                  <section className="conflict-technical">
                    <h4>{t("technicalDetails")}</h4>
                    <code>{conflict.path}</code>
                    {conflict.reason && <p>{conflict.reason}</p>}
                    <div className="history-conflict-values">
                      {(["base", "ours", "theirs"] as const).map((side) => (
                        <div key={side}>
                          <small>{t(`side.${side}`)}</small>
                          <pre>{rawText(conflict[side])}</pre>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              ) : (
                <>
                  <div className="conflict-detail-heading">
                    <div>
                      <span className="conflict-eyebrow">
                        {t("mergedPreview")}
                      </span>
                      <h3>
                        {remaining ? t("previewPending") : t("readyToSave")}
                      </h3>
                    </div>
                  </div>
                  <p className="conflict-help">
                    {remaining ? t("previewPendingHelp") : t("mergeReadyHelp")}
                  </p>
                  <div className="conflict-page-preview">
                    <ConflictPagePreview
                      value={result.document}
                      expandContent
                    />
                  </div>
                  <section className="conflict-base">
                    <h4>
                      {t("otherChanges", { count: preview.changes.length })}
                    </h4>
                    <ChangeList changes={preview.changes} expandContent />
                  </section>
                </>
              )}
            </section>
          </div>
          <footer className="conflict-footer">
            <div className="conflict-footer-secondary">
              {!saveFailure && (
                <button
                  className="studio-button"
                  disabled={busy}
                  onClick={onClose}
                >
                  {t("keepDraftAndReturn")}
                </button>
              )}
              {saveFailure && onDiscard && (
                <button
                  className="studio-text-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await onDiscard();
                      onClose();
                    })
                  }
                >
                  {t("discardDraft")}
                </button>
              )}
              {saveFailure && onEdit && (
                <button
                  className="studio-button"
                  disabled={busy}
                  onClick={() => {
                    onEdit(
                      result.document,
                      preview.currentRevision,
                      preview.currentHash,
                    );
                    onClose();
                  }}
                >
                  {t("continueInPage")}
                </button>
              )}
            </div>
            <div className="conflict-save">
              <span aria-live="polite">
                {remaining
                  ? t("remainingConflicts", { count: remaining })
                  : t("allChangesResolved")}
              </span>
              <button
                className="studio-button primary"
                disabled={busy || remaining > 0}
                onClick={() => void save()}
              >
                {busy ? (
                  <Loader2 size={15} className="studio-spin" />
                ) : (
                  <Check size={15} />
                )}
                {t("saveMerged")}
              </button>
            </div>
          </footer>
        </>
      ) : (
        <div className="conflict-loading">
          {!error && (
            <>
              <Loader2 size={18} className="studio-spin" />
              {t("loadingComparison")}
            </>
          )}
          {error && saveFailure && onDiscard && (
            <button
              className="studio-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await onDiscard();
                  onClose();
                })
              }
            >
              {t("discardAndLoad")}
            </button>
          )}
        </div>
      )}
    </Dialog>
  );
}

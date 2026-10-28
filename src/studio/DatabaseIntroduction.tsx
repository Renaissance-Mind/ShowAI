import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import type { DatasetSession } from "../datasets/client";
import { useDatasetSnapshot } from "../datasets/react";
import { equalValues } from "../datasets/operations.mjs";
import { validateProjectDatabaseData } from "../core/project-database";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/databaseIntroduction";
import { Plus } from "../ui/icons";
import { databaseIntroductionOperations } from "./database-introduction";
import "./database-introduction.css";

const RichTextEditor = lazy(
  () => import("../components/rich-text/RichTextEditor"),
);
const empty: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

/** Mounted only at a database project's root, using its existing shared session. */
export default function DatabaseIntroduction({
  session,
  readOnly,
}: {
  session: DatasetSession;
  readOnly: boolean;
}) {
  const t = useTranslator(messages);
  const snapshot = useDatasetSnapshot(session)!;
  const data = useMemo(() => {
    if (snapshot.status !== "ready") return undefined;
    try {
      return validateProjectDatabaseData(snapshot.value);
    } catch {
      return undefined;
    }
  }, [snapshot.status, snapshot.value]);
  const intro = data?.intro;
  const [draft, setDraft] = useState(intro);
  const [expanded, setExpanded] = useState(!!intro);
  const [error, setError] = useState("");
  const basis = useRef(intro);
  const focused = useRef(false);
  const focusRequested = useRef(false);
  const conflicted = snapshot.conflicts.some(
    (conflict) => conflict.path[0] === "intro",
  );
  const previousConflict = useRef(conflicted);
  const locked =
    readOnly || snapshot.readOnly || snapshot.status !== "ready" || !data;

  const sync = useCallback(() => {
    const current = session.getSnapshot();
    if (current.status !== "ready") return;
    let value: JSONContent | undefined;
    try {
      value = validateProjectDatabaseData(current.value).intro;
    } catch {
      return;
    }
    basis.current = value;
    setDraft((previous) => (equalValues(previous, value) ? previous : value));
    if (value) setExpanded(true);
  }, [session]);
  useEffect(() => {
    // An external write can arrive while typing. Keep the editor and its basis
    // until blur; the next local write then uses its original precondition.
    if (
      (!focused.current && !error && !conflicted) ||
      (previousConflict.current && !conflicted)
    )
      sync();
    previousConflict.current = conflicted;
  }, [intro, conflicted, error, sync]);
  const editorReady = useCallback((editor: Editor) => {
    if (focusRequested.current) {
      focusRequested.current = false;
      editor.commands.focus("end");
    }
  }, []);

  if (!expanded && !intro) {
    if (locked) return null;
    return (
      <div className="database-introduction">
        <button
          type="button"
          className="database-introduction-add"
          onClick={() => {
            focusRequested.current = true;
            setExpanded(true);
          }}
        >
          <Plus size={14} />
          {t("add")}
        </button>
      </div>
    );
  }

  return (
    <section
      className="database-introduction"
      aria-label={t("region")}
      style={
        {
          "--database-introduction-placeholder": JSON.stringify(
            t("placeholder"),
          ),
        } as CSSProperties
      }
      onFocusCapture={() => {
        focused.current = true;
      }}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return;
        focused.current = false;
        if (!error && !conflicted) sync();
      }}
    >
      <Suspense
        fallback={
          <div className="database-introduction-loading" role="status">
            {t("opening")}
          </div>
        }
      >
        <RichTextEditor
          content={draft ?? intro ?? empty}
          readOnly={locked || conflicted}
          minimal
          trailingNode={false}
          onEditorReady={editorReady}
          onChange={(next) => {
            const current = session.getSnapshot();
            if (
              locked ||
              conflicted ||
              current.readOnly ||
              current.status !== "ready"
            )
              return;
            setDraft(next);
            try {
              const conflicts = session.edit(
                databaseIntroductionOperations(next, basis.current),
              );
              if (!conflicts.length) basis.current = next;
              setError("");
            } catch {
              setError(t("invalid"));
            }
          }}
        />
      </Suspense>
      {error && (
        <p className="database-introduction-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Replace,
  ReplaceAll,
  X,
} from "../../ui/icons";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/find";
import { formatShortcut, clientIsMac } from "../keyboard-shortcuts";
import { findPattern, nearestMatch, stepMatch } from "./find-model";
import {
  clearPaint,
  editableEditor,
  findInPage,
  paintMatches,
  replaceMatches,
  scrollToMatch,
  type PageMatch,
} from "./find-dom";
import "./find-bar.css";

export type FindCommand = "open" | "replace" | "next" | "previous";
export interface FindRequest {
  command: FindCommand;
  /** Each request is new, so repeating a command runs it again. */
  id: number;
}

/** The query and options survive closing the bar, as in other editors. */
const remembered = { query: "", caseSensitive: false };

/** A short single-line selection seeds the query when the bar opens. */
function selectedQuery() {
  const text = window.getSelection()?.toString() ?? "";
  return text && text.length <= 200 && !/[\r\n]/.test(text) ? text : null;
}

export function FindBar({
  request,
  page,
  readOnly,
  onClose,
  onReveal,
}: {
  request: FindRequest;
  /** The open page's content element. */
  page: () => HTMLElement | null;
  readOnly: boolean;
  onClose: () => void;
  /** Moves a board's camera to an object whose text is out of view. */
  onReveal: (nodeId: string) => void;
}) {
  const t = useTranslator(messages);
  const mac = clientIsMac();
  const [query, setQuery] = useState(
    () => selectedQuery() ?? remembered.query,
  );
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(
    remembered.caseSensitive,
  );
  const [replacing, setReplacing] = useState(
    request.command === "replace" && !readOnly,
  );
  const [state, setState] = useState({ current: -1, total: 0 });
  const [status, setStatus] = useState("");
  const matches = useRef<PageMatch[]>([]);
  const current = useRef(-1);
  const queryInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);
  if (returnFocus.current === null)
    returnFocus.current = document.activeElement ?? document.body;
  remembered.query = query;
  remembered.caseSensitive = caseSensitive;

  const show = useCallback(
    (index: number, reveal: boolean) => {
      current.current = index;
      paintMatches(matches.current, index);
      setState({ current: index, total: matches.current.length });
      const match = matches.current[index];
      const root = page();
      if (!reveal || !match || !root) return;
      if (!scrollToMatch(match, root)) {
        const owner = match.range.startContainer.parentElement?.closest<HTMLElement>(
          "[data-surface-id]",
        );
        if (owner?.dataset.surfaceId) {
          onReveal(owner.dataset.surfaceId);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => scrollToMatch(match, root)),
          );
        }
      }
    },
    [page, onReveal],
  );

  /** Finds again; the current match stays where it was unless asked to move. */
  const search = useCallback(
    (reveal: boolean) => {
      const root = page();
      const previous = matches.current[current.current] ?? null;
      matches.current = root ? findInPage(root, query, { caseSensitive }) : [];
      show(nearestMatch(matches.current, previous), reveal);
    },
    [page, query, caseSensitive, show],
  );

  useLayoutEffect(() => {
    search(true);
  }, [search]);

  // Edits, lazily mounted component bodies and board changes update the matches.
  useEffect(() => {
    const root = page();
    if (!root) return;
    let timer = 0;
    const observer = new MutationObserver((records) => {
      if (records.every((record) => bar.current?.contains(record.target)))
        return;
      clearTimeout(timer);
      timer = window.setTimeout(() => search(false), 160);
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [page, search]);

  useEffect(() => () => clearPaint(), []);

  const step = useCallback(
    (direction: 1 | -1) => {
      if (!matches.current.length) search(false);
      show(stepMatch(current.current, matches.current.length, direction), true);
    },
    [search, show],
  );

  const close = useCallback(() => {
    clearPaint();
    onClose();
    const target = returnFocus.current;
    if (target instanceof HTMLElement && target.isConnected)
      target.focus({ preventScroll: true });
  }, [onClose]);

  /** The field a request focuses once the replace row has rendered. */
  const [focusTarget, setFocusTarget] = useState<{
    field: "query" | "replacement";
    id: number;
  } | null>(null);
  useEffect(() => {
    if (request.command === "next") step(1);
    else if (request.command === "previous") step(-1);
    else {
      const replace = request.command === "replace" && !readOnly;
      if (replace) setReplacing(true);
      const seeded = selectedQuery();
      if (seeded && !bar.current?.contains(document.activeElement))
        setQuery(seeded);
      setFocusTarget({
        field: replace ? "replacement" : "query",
        id: request.id,
      });
    }
    // Only a new request runs a command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);
  useLayoutEffect(() => {
    if (!focusTarget) return;
    // Replacing starts in the replacement field once there is a query.
    const input =
      focusTarget.field === "replacement" && query
        ? replaceInput.current
        : queryInput.current;
    if (!input) return;
    input.focus();
    input.select();
    setFocusTarget(null);
  }, [focusTarget, replacing]);

  // A page that becomes read-only hides replacing.
  useEffect(() => {
    if (readOnly) setReplacing(false);
  }, [readOnly]);

  const replaceCurrent = () => {
    const match = matches.current[current.current];
    if (!match || !replaceMatches([match], replacement)) return step(1);
    // The editor updates its text at once; find again from this place, and
    // move past a replacement that itself contains the query.
    search(false);
    const next = matches.current[current.current];
    if (
      next?.segment === match.segment &&
      next.start === match.start &&
      findPattern(query, { caseSensitive })?.test(replacement)
    )
      step(1);
    else show(current.current, true);
  };
  const replaceAll = () => {
    const count = replaceMatches(matches.current, replacement);
    search(false);
    setStatus(t("replaced", { count }));
  };
  useEffect(() => {
    setStatus("");
  }, [query, caseSensitive, replacement]);

  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  const replaceEnabled =
    !readOnly &&
    matches.current.some((match) => editableEditor(match) !== null);
  const hint = (label: string, chord: string) =>
    `${label} (${formatShortcut(chord, mac)})`;

  return (
    <div
      ref={bar}
      className="find-bar"
      role="search"
      aria-label={t("bar")}
      onKeyDown={keys}
    >
      {!readOnly && (
        <button
          type="button"
          className="studio-icon find-bar-toggle"
          aria-label={replacing ? t("hideReplace") : t("showReplace")}
          aria-expanded={replacing}
          title={replacing ? t("hideReplace") : t("showReplace")}
          onClick={() => setReplacing((value) => !value)}
        >
          {replacing ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
      )}
      <div className="find-bar-rows">
        <div className="find-bar-row">
          <input
            ref={queryInput}
            className="find-bar-input"
            type="search"
            aria-label={t("query")}
            placeholder={t("query")}
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }}
          />
          <span className="find-bar-count" aria-live="polite">
            {query
              ? state.total
                ? t("count", {
                    current: state.current + 1,
                    total: state.total,
                  })
                : t("none")
              : ""}
          </span>
          <button
            type="button"
            className="studio-icon"
            aria-label={t("caseSensitive")}
            title={t("caseSensitive")}
            aria-pressed={caseSensitive}
            data-active={caseSensitive || undefined}
            onClick={() => setCaseSensitive((value) => !value)}
          >
            <CaseSensitive size={16} />
          </button>
          <button
            type="button"
            className="studio-icon"
            aria-label={t("previous")}
            title={hint(t("previous"), "Shift+Mod+G")}
            disabled={!state.total}
            onClick={() => step(-1)}
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            className="studio-icon"
            aria-label={t("next")}
            title={hint(t("next"), "Mod+G")}
            disabled={!state.total}
            onClick={() => step(1)}
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            className="studio-icon"
            aria-label={t("close")}
            title={hint(t("close"), "Escape")}
            onClick={close}
          >
            <X size={15} />
          </button>
        </div>
        {replacing && !readOnly && (
          <div className="find-bar-row">
            <input
              ref={replaceInput}
              className="find-bar-input"
              type="text"
              aria-label={t("replacement")}
              placeholder={t("replacement")}
              spellCheck={false}
              autoComplete="off"
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                if (event.metaKey || event.ctrlKey) replaceAll();
                else replaceCurrent();
              }}
            />
            <span className="find-bar-count" aria-live="polite">
              {status}
            </span>
            <button
              type="button"
              className="studio-icon"
              aria-label={t("replace")}
              title={hint(t("replace"), "Enter")}
              disabled={!replaceEnabled}
              onClick={replaceCurrent}
            >
              <Replace size={15} />
            </button>
            <button
              type="button"
              className="studio-icon"
              aria-label={t("replaceAll")}
              title={hint(t("replaceAll"), "Mod+Enter")}
              disabled={!replaceEnabled}
              onClick={replaceAll}
            >
              <ReplaceAll size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { AgentConversationSummary } from "../../agent-host/types";
import { desktop, errorMessage } from "../bridge";
import { useTranslator } from "../../i18n/react";
import strings from "../../i18n/messages/assistant";
import { ChevronDown, Plus, Search } from "../../ui/icons";

type Option = { id: string; title: string; running?: boolean };

/**
 * The conversation picker in the Agent panel header: the current title opens
 * a searchable list of the project's conversations, and turns into a text
 * field while the conversation is renamed.
 */
export function ConversationSwitcher({
  projectId,
  summaries,
  currentId,
  currentTitle,
  renaming,
  onSelect,
  onNew,
  onRename,
  onError,
}: {
  projectId: string | null;
  summaries: AgentConversationSummary[];
  /** The open conversation; null while a new one is being written. */
  currentId: string | null;
  currentTitle: string;
  renaming: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** A new title, or null when renaming was cancelled. */
  onRename: (title: string | null) => void;
  onError: (message: string) => void;
}) {
  const t = useTranslator(strings);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AgentConversationSummary[] | null>(
    null,
  );
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const searching = !!query.trim();
  const options: Option[] = searching
    ? (results ?? [])
    : [{ id: "", title: t("panel.startedNew") }, ...summaries];

  useEffect(() => {
    if (!open || !projectId || !searching) {
      setResults(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      desktop
        .invoke<AgentConversationSummary[]>("agent:conversations", {
          projectId,
          query,
        })
        .then(
          (items) => current && setResults(items),
          (reason) => current && onError(errorMessage(reason)),
        );
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, projectId, query, searching, summaries]);

  useEffect(() => setActive(0), [query, open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    trigger.current?.focus();
  };
  const choose = (option: Option | undefined) => {
    if (!option) return;
    close();
    if (option.id) onSelect(option.id);
    else onNew();
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) =>
        options.length ? (index + step + options.length) % options.length : 0,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  if (renaming)
    return (
      <RenameField
        title={currentTitle}
        label={t("panel.rename")}
        onDone={(title) => {
          onRename(title);
          requestAnimationFrame(() => trigger.current?.focus());
        }}
      />
    );
  return (
    <div className="assistant-switcher" ref={root}>
      <button
        type="button"
        ref={trigger}
        className="assistant-switcher-trigger"
        aria-label={t("panel.conversations")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{currentId ? currentTitle : t("panel.startedNew")}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className="assistant-switcher-popover">
          <label className="assistant-switcher-search">
            <Search size={13} aria-hidden="true" />
            <input
              autoFocus
              role="combobox"
              aria-label={t("panel.search")}
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={
                options[active] ? `${listId}-${active}` : undefined
              }
              placeholder={t("panel.search")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={keys}
            />
          </label>
          <div
            id={listId}
            role="listbox"
            aria-label={t("panel.conversations")}
            className="assistant-switcher-list"
          >
            {options.map((option, index) => (
              <div
                key={option.id || "new"}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                data-current={
                  (option.id || null) === currentId ? "true" : undefined
                }
                onPointerMove={() => setActive(index)}
                onClick={() => choose(option)}
              >
                {option.id ? (
                  option.running && (
                    <span
                      className="assistant-thread-dot"
                      aria-label={t("panel.running")}
                    />
                  )
                ) : (
                  <Plus size={13} aria-hidden="true" />
                )}
                <span>{option.title}</span>
              </div>
            ))}
            {searching && results && !results.length && (
              <p className="assistant-switcher-empty" role="status">
                {t("panel.noMatches")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RenameField({
  title,
  label,
  onDone,
}: {
  title: string;
  label: string;
  onDone: (title: string | null) => void;
}) {
  const [value, setValue] = useState(title);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next?.trim() && next.trim() !== title ? next : null);
  };
  return (
    <input
      className="assistant-rename"
      aria-label={label}
      value={value}
      maxLength={200}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          finish(value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      }}
    />
  );
}

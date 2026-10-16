import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AssistantContext,
  type AssistantAnchor,
  type AssistantBridge,
  type AssistantTarget,
} from "../../components/assistant-context";
import type {
  AgentConversation,
  AgentConversationSummary,
  AgentHostStatus,
  AgentTarget,
  AgentTurn,
} from "../../agent-host/types";
import { desktop, errorMessage } from "../bridge";
import { MacPairingPrompt } from "../LanPairing";
import { AgentExecutionPicker, remoteExecution } from "../AgentExecution";
import type { Translator } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import strings from "../../i18n/messages/assistant";
import {
  ArrowUp,
  Loader2,
  LocateFixed,
  Plus,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  X,
} from "../../ui/icons";
import { downloadAgentFile } from "./message-links";
import "./assistant.css";
import { useAssistantDrafts } from "./useAssistantDrafts";
import { AgentMarkdown } from "./AgentMarkdown";
import {
  referenceRequest,
  referencePicked,
  referenceDisplay,
  type CanvasReference,
} from "../../surface/agent-reference";

const agentNames: Record<string, string> = {
  codex: "Codex",
  claude: "Claude Code",
  kimi: "Kimi",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
};
const widthPreference = "showai:assistant-width";
const quickActions = [
  "polish",
  "shorten",
  "expand",
  "translate",
  "visualize",
  "explain",
] as const;

type Translate = Translator<(typeof strings)["catalogs"]["zh-CN"]>;

function targetLabel(
  t: Translate,
  target: Pick<AgentTarget, "kind" | "blockIds"> | null,
  pageTitle?: string,
) {
  const count = target?.blockIds?.length ?? 0;
  if (!target || target.kind === "page")
    return pageTitle
      ? t("target.pageNamed", { title: pageTitle })
      : t("target.page");
  if (target.kind === "text") return t("target.text");
  if (target.kind === "board") return t("target.board", { count });
  return t("target.blocks", { count });
}

function TurnView({
  turn,
  latest,
  onLocate,
  onCancel,
  onUndo,
  onPermission,
  onFile,
}: {
  turn: AgentTurn;
  latest: boolean;
  onLocate: (pageId: string, ids: string[]) => void;
  onCancel: () => void;
  onUndo: () => void;
  onPermission: (id: string, option: string | null) => void;
  onFile: (path: string) => void;
}) {
  const t = useTranslator(strings);
  const groups: {
    sequence: number;
    tools?: typeof turn.events;
    message?: string;
  }[] = [];
  for (const event of turn.events) {
    if (event.type === "message")
      groups.push({ sequence: event.sequence, message: event.text });
    if (event.type === "tool") {
      const last = groups.at(-1);
      if (last?.tools) last.tools.push(event);
      else groups.push({ sequence: event.sequence, tools: [event] });
    }
  }
  const changed = turn.changedBlockIds ?? [];
  const pageChanged =
    turn.wrotePage ??
    (!!turn.resultHash && !!turn.baseHash && turn.resultHash !== turn.baseHash);
  return (
    <article className="assistant-turn" aria-label={turn.label}>
      <div className="assistant-user">
        <p>{turn.prompt}</p>
        <button
          type="button"
          className="assistant-chip"
          disabled={!turn.target.pageId}
          onClick={() =>
            turn.target.pageId &&
            onLocate(turn.target.pageId, turn.target.blockIds ?? [])
          }
        >
          <LocateFixed size={12} aria-hidden="true" />
          <span>{targetLabel(t, turn.target, turn.pageTitle)}</span>
        </button>
        {turn.target.text && (
          <blockquote className="assistant-quote">
            {turn.target.text}
          </blockquote>
        )}
      </div>
      <div className="assistant-reply">
        {groups.map((group) =>
          group.tools ? (
            <details className="assistant-steps" key={group.sequence}>
              <summary>
                {group.tools.some((event) => event.state === "running") && (
                  <Loader2 size={12} className="studio-spin" />
                )}{" "}
                {t("panel.steps", { count: group.tools.length })}
              </summary>
              <ol>
                {group.tools.map((event) => (
                  <li key={event.sequence} data-state={event.state}>
                    <pre>{event.text}</pre>
                  </li>
                ))}
              </ol>
            </details>
          ) : (
            <div key={group.sequence} className="assistant-message">
              <AgentMarkdown text={group.message ?? ""} onFile={onFile} />
            </div>
          ),
        )}
        {turn.approvals?.map((approval) => (
          <div className="assistant-approval" key={approval.id}>
            <p>{approval.title}</p>
            <div>
              {approval.options.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  onClick={() => onPermission(approval.id, option.id)}
                >
                  {option.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onPermission(approval.id, null)}
              >
                {t("panel.reject")}
              </button>
            </div>
          </div>
        ))}
        {turn.state === "running" && (
          <p className="assistant-status" role="status">
            <Loader2 size={13} className="studio-spin" aria-hidden="true" />
            <span>
              {turn.events.length ? t("panel.running") : t("panel.connecting")}
            </span>
            <button type="button" onClick={onCancel}>
              <Square size={11} aria-hidden="true" />
              {t("panel.stop")}
            </button>
          </p>
        )}
        {turn.error && turn.state !== "running" && (
          <p className="assistant-error" role="alert">
            {turn.error}
          </p>
        )}
        {turn.state !== "running" && pageChanged && turn.pageId && (
          <div className="assistant-result">
            <span>
              {changed.length
                ? t("panel.changed", { count: changed.length })
                : t("panel.changedPage")}
            </span>
            {changed.length > 0 && (
              <button
                type="button"
                onClick={() => onLocate(turn.pageId!, changed)}
              >
                <LocateFixed size={12} aria-hidden="true" />
                {t("panel.locate")}
              </button>
            )}
            {turn.undone ? (
              <span className="assistant-undone">{t("panel.undone")}</span>
            ) : (
              latest && (
                <button type="button" onClick={onUndo}>
                  <Undo2 size={12} aria-hidden="true" />
                  {t("panel.undo")}
                </button>
              )
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** Floating request box opened from selection, block, board and page menus. */
function Composer({
  target,
  pageTitle,
  busy,
  error,
  destination,
  onSend,
  onClose,
}: {
  target: AssistantTarget;
  pageTitle?: string;
  busy: boolean;
  error: string;
  destination: ReactNode;
  onSend: (prompt: string) => void;
  onClose: () => void;
}) {
  const t = useTranslator(strings);
  const [text, setText] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const anchor: AssistantAnchor = target.anchor ?? {
    left: window.innerWidth / 2,
    top: 120,
    bottom: 120,
  };
  const [position, setPosition] = useState({
    left: anchor.left,
    top: anchor.bottom + 8,
  });
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const below = anchor.bottom + 8;
    const top =
      below + height <= window.innerHeight - 8
        ? below
        : Math.max(8, anchor.top - height - 8);
    setPosition({
      left: Math.max(
        8,
        Math.min(anchor.left - width / 2, window.innerWidth - width - 8),
      ),
      top,
    });
  }, [anchor.left, anchor.top, anchor.bottom]);
  useEffect(() => {
    input.current?.focus();
    const outside = (event: Event) => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [onClose]);
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      text.trim()
    ) {
      event.preventDefault();
      onSend(text.trim());
    }
  };
  const selection = target.kind !== "page";
  return createPortal(
    <div
      ref={box}
      className="assistant-composer"
      role="dialog"
      aria-label={t("composer.label")}
      style={position}
      onKeyDown={keyDown}
    >
      <header>
        <Sparkles size={14} aria-hidden="true" />
        <span className="assistant-chip is-static">
          {targetLabel(t, target, pageTitle)}
        </span>
        <button
          type="button"
          className="assistant-icon"
          aria-label={t("composer.close")}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </header>
      {selection && (
        <div
          className="assistant-quick"
          role="group"
          aria-label={t("quick.label")}
        >
          {quickActions.map((name) => (
            <button
              type="button"
              key={name}
              disabled={busy}
              onClick={() => onSend(t(`quick.${name}Prompt`))}
            >
              {t(`quick.${name}`)}
            </button>
          ))}
        </div>
      )}
      <div className="assistant-input">
        <textarea
          ref={input}
          rows={2}
          value={text}
          placeholder={t("panel.placeholder")}
          onChange={(event) => setText(event.target.value)}
        />
        <button
          type="button"
          className="assistant-send"
          aria-label={t("panel.send")}
          disabled={busy || !text.trim()}
          onClick={() => onSend(text.trim())}
        >
          {busy ? (
            <Loader2 size={14} className="studio-spin" />
          ) : (
            <ArrowUp size={14} />
          )}
        </button>
      </div>
      <footer>{destination}</footer>
      {error && (
        <p className="assistant-error" role="alert">
          {error}
        </p>
      )}
    </div>,
    document.body,
  );
}

export default function AssistantWorkbench({
  enabled,
  open,
  onOpenChange,
  projectId,
  pageId,
  pageTitle,
  flush,
  onLocate,
  onOpenSettings,
  children,
}: {
  enabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  pageId: string | null;
  pageTitle?: string;
  flush: () => Promise<boolean>;
  onLocate: (pageId: string, ids: string[]) => void;
  onOpenSettings: () => void;
  children: ReactNode;
}) {
  const t = useTranslator(strings);
  const [summaries, setSummaries] = useState<AgentConversationSummary[]>([]);
  const [conversation, setConversation] = useState<AgentConversation | null>(
    null,
  );
  const [fresh, setFresh] = useState(false);
  const [composer, setComposer] = useState<AssistantTarget | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const composerKey = `${projectId ?? ""}/${fresh ? "new" : (selectedId ?? "new")}`;
  const messageDraft = useAssistantDrafts(composerKey);
  const draft = messageDraft.text,
    panelTarget = messageDraft.pageId === pageId ? messageDraft.target : null,
    reference = messageDraft.pageId === pageId ? messageDraft.reference : null;
  const setDraft = (text: string) => messageDraft.update({ text });
  const setPanelTarget = (target: AssistantTarget | null) =>
    messageDraft.update({ target, pageId });
  const setReference = (value: CanvasReference | null) =>
    messageDraft.update({ reference: value, pageId });
  const [sendingKeys, setSendingKeys] = useState<string[]>([]);
  const sending = useRef(new Set<string>());
  const busy = sendingKeys.includes(composerKey);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<AgentHostStatus | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [executionRevision, setExecutionRevision] = useState(0);
  const executionGeneration = useRef(0);
  const selectionGeneration = useRef(0);
  const conversationCache = useRef(new Map<string, AgentConversation>());
  const rememberedThreads = useRef(new Map<string, string>());
  useEffect(() => {
    const change = () => {
      executionGeneration.current++;
      setConversation(null);
      setFresh(true);
      setExecutionRevision((v) => v + 1);
    };
    window.addEventListener("showai-agent-execution-change", change);
    return () =>
      window.removeEventListener("showai-agent-execution-change", change);
  }, []);
  const [width, setWidth] = useState(() => {
    const value = Number(localStorage.getItem(widthPreference));
    return Number.isFinite(value) && value >= 300 ? Math.min(value, 640) : 380;
  });
  const list = useRef<HTMLDivElement>(null);
  const project = useRef(projectId);
  project.current = projectId;
  useEffect(() => {
    const picked = (event: Event) => {
      const value = (event as CustomEvent).detail;
      if (value?.pageId === pageId) setReference(value.reference);
    };
    window.addEventListener(referencePicked, picked);
    return () => window.removeEventListener(referencePicked, picked);
  }, [pageId, composerKey]);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(referenceDisplay, { detail: { pageId, reference } }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent(referenceDisplay, {
          detail: { pageId, reference: null },
        }),
      );
    };
  }, [pageId, reference]);
  const pickReference = () => {
    if (!pageId) return;
    const request = new CustomEvent(referenceRequest, {
      cancelable: true,
      detail: { id: crypto.randomUUID(), pageId },
    });
    window.dispatchEvent(request);
    if (!request.defaultPrevented) setError(t("reference.noCanvas"));
  };

  const loadSummaries = useCallback(async (id: string) => {
    const generation = executionGeneration.current;
    const next = await desktop.invoke<AgentConversationSummary[]>(
      "agent:conversations",
      { projectId: id },
    );
    if (project.current !== id || executionGeneration.current !== generation)
      return [];
    setSummaries(next);
    return next;
  }, []);
  const select = useCallback(async (projectKey: string, id: string) => {
    const selection = ++selectionGeneration.current;
    rememberedThreads.current.set(projectKey, id);
    setSelectedId(id);
    setFresh(false);
    setConfirmDelete(false);
    setError("");
    setConversation(conversationCache.current.get(id) ?? null);
    const generation = executionGeneration.current;
    const next = await desktop.invoke<AgentConversation>("agent:conversation", {
      projectId: projectKey,
      id,
    });
    if (
      project.current === projectKey &&
      executionGeneration.current === generation &&
      selectionGeneration.current === selection
    ) {
      conversationCache.current.set(id, next);
      setConversation(next);
      setFresh(false);
    }
  }, []);
  // Conversations belong to the project; switching projects starts from its latest one.
  useEffect(() => {
    setConversation(null);
    setSelectedId(null);
    selectionGeneration.current++;
    setSummaries([]);
    setFresh(false);
    setError("");
    if (!projectId || !open) return;
    void loadSummaries(projectId)
      .then((items) => {
        const remembered = rememberedThreads.current.get(projectId);
        const item = items.find((item) => item.id === remembered) ?? items[0];
        if (item) return select(projectId, item.id);
      })
      .catch((reason) => setError(errorMessage(reason)));
  }, [projectId, open, loadSummaries, select, executionRevision]);
  useEffect(() => {
    if (!open && !composer) return;
    let stopped = false;
    void desktop
      .invoke<AgentHostStatus>("agent:status", { projectId })
      .then((value) => {
        if (!stopped) setStatus(value);
      })
      .catch(() => {
        if (!stopped) setStatus(null);
      });
    return () => {
      stopped = true;
    };
  }, [open, !!composer, projectId, executionRevision]);

  const running = conversation?.turns.find((turn) => turn.state === "running");
  useEffect(() => {
    if (!open || !projectId || !summaries.some((item) => item.running)) return;
    let pending = false;
    const timer = setInterval(
      () => {
        if (pending) return;
        pending = true;
        void loadSummaries(projectId)
          .catch((reason) => setError(errorMessage(reason)))
          .finally(() => {
            pending = false;
          });
      },
      remoteExecution() ? 4000 : 1600,
    );
    return () => clearInterval(timer);
  }, [projectId, open, summaries.some((item) => item.running), loadSummaries]);
  useEffect(() => {
    if (!conversation || !running) return;
    let stopped = false;
    let nextPoll = 0,
      failures = 0,
      polling = false;
    const timer = setInterval(
      () => {
        if (polling || Date.now() < nextPoll) return;
        polling = true;
        void desktop
          .invoke<{ turn: AgentTurn; threadId?: string }>("agent:turn", {
            projectId: conversation.projectId,
            conversationId: conversation.id,
            id: running.id,
          })
          .then(({ turn, threadId }) => {
            failures = 0;
            if (stopped) return;
            setConversation((current) =>
              current?.id === conversation.id
                ? {
                    ...current,
                    threadId,
                    turns: current.turns.map((item) =>
                      item.id === turn.id ? turn : item,
                    ),
                  }
                : current,
            );
            if (turn.state !== "running")
              void loadSummaries(conversation.projectId);
          })
          .catch((reason) => {
            nextPoll =
              Date.now() + Math.min(60000, 2000 * 2 ** Math.min(++failures, 5));
            if (!stopped) setError(errorMessage(reason));
          })
          .finally(() => {
            polling = false;
          });
      },
      remoteExecution() ? 2000 : 700,
    );
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [conversation?.id, running?.id, loadSummaries]);
  // A new turn or conversation jumps to the end; streamed output follows only near the end.
  const lastEvent = running?.events.at(-1);
  useLayoutEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [conversation?.id, conversation?.turns.length]);
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 160)
      element.scrollTop = element.scrollHeight;
  }, [lastEvent?.sequence, lastEvent?.text.length, running?.state]);

  const send = async (prompt: string, target: AssistantTarget | null) => {
    if (
      (!fresh && selectedId && !conversation) ||
      !projectId ||
      !prompt.trim() ||
      sending.current.has(composerKey) ||
      (!fresh && running)
    )
      return false;
    const sentText = draft;
    sending.current.add(composerKey);
    setSendingKeys([...sending.current]);
    setError("");
    const sentDraftKey = composerKey,
      selection = selectionGeneration.current;
    try {
      if (!(await flush())) throw new Error(t("panel.saveFirst"));
      const hostTarget: AgentTarget = {
        kind: target?.kind ?? "page",
        ...(pageId ? { pageId } : {}),
        ...(target && "blockIds" in target && target.blockIds.length
          ? { blockIds: target.blockIds }
          : {}),
        ...(target?.kind === "board" && target.surfaceId
          ? { surfaceId: target.surfaceId }
          : {}),
        ...(target?.kind === "text" && target.text
          ? { text: target.text }
          : {}),
        ...(reference ? { reference } : {}),
      };
      const next = await desktop.invoke<AgentConversation>("agent:send", {
        projectId,
        ...(conversation && !fresh ? { conversationId: conversation.id } : {}),
        prompt,
        target: hostTarget,
      });
      if (project.current !== projectId) return true;
      conversationCache.current.set(next.id, next);
      messageDraft.clear(sentDraftKey, sentText);
      void loadSummaries(projectId);
      if (selectionGeneration.current !== selection) return true;
      setSelectedId(next.id);
      setConversation(next);
      setFresh(false);
      onOpenChange(true);
      void loadSummaries(projectId);
      return true;
    } catch (reason) {
      if (
        selectionGeneration.current === selection &&
        project.current === projectId
      )
        setError(errorMessage(reason));
      return false;
    } finally {
      sending.current.delete(sentDraftKey);
      setSendingKeys([...sending.current]);
    }
  };
  const act = (work: () => Promise<unknown>) => () =>
    void work().catch((reason) => setError(errorMessage(reason)));

  const bridge = useMemo<AssistantBridge | null>(
    () =>
      enabled && projectId
        ? {
            open: (target) => {
              setError("");
              setComposer(target);
            },
          }
        : null,
    [enabled, projectId],
  );
  const closeComposer = useCallback(() => setComposer(null), []);

  const agentLabel = (() => {
    const mode =
      conversation && !fresh ? conversation : (status?.settings ?? null);
    if (!mode) return "";
    if (mode.mode === "local") {
      const id =
        "localAgent" in mode && mode.localAgent
          ? mode.localAgent
          : status?.settings.localAgent;
      return t("panel.agentLocal", { name: agentNames[id ?? "codex"] });
    }
    const sourceId = "sourceId" in mode ? mode.sourceId : undefined;
    const source = status?.settings.sources.find(
      (item) => item.id === sourceId,
    );
    return source
      ? t("panel.agentApi", { source: source.name, model: source.model || "—" })
      : "";
  })();
  const destination = (
    <span className="assistant-destination">
      <span>
        {conversation && !fresh
          ? t("panel.sendTo", { title: conversation.title })
          : t("panel.sendToNew")}
      </span>
      {conversation && (
        <button
          type="button"
          onClick={() => {
            selectionGeneration.current++;
            setFresh(!fresh);
          }}
        >
          {fresh ? t("panel.useCurrent") : t("panel.useNew")}
        </button>
      )}
    </span>
  );

  const resize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const start = event.clientX,
      initial = width;
    const move = (next: globalThis.PointerEvent) => {
      const value = Math.max(
        300,
        Math.min(640, initial + start - next.clientX),
      );
      setWidth(value);
      localStorage.setItem(widthPreference, String(value));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const turns = conversation?.turns ?? [];
  return (
    <AssistantContext.Provider value={bridge}>
      {children}
      {!remoteExecution() && <MacPairingPrompt />}
      {composer && bridge && (
        <Composer
          target={composer}
          pageTitle={pageTitle}
          busy={busy}
          error={error}
          destination={destination}
          onClose={closeComposer}
          onSend={(prompt) =>
            void send(prompt, composer).then(
              (sent) => sent && setComposer(null),
            )
          }
        />
      )}
      {open && enabled && (
        <aside
          className="assistant-panel"
          aria-label={t("panel.title")}
          style={{ width }}
        >
          <div
            className="assistant-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("panel.resize")}
            onPointerDown={resize}
          />
          <AgentExecutionPicker
            projectId={projectId}
            disabled={!!running || busy}
          />
          <header className="assistant-header">
            <select
              aria-label={t("panel.conversations")}
              value={fresh || !conversation ? "" : conversation.id}
              onChange={(event) =>
                event.target.value
                  ? projectId &&
                    act(() => select(projectId, event.target.value))()
                  : setFresh(true)
              }
            >
              <option value="">{t("panel.startedNew")}</option>
              {summaries.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.running ? "● " : ""}
                  {item.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="assistant-icon"
              aria-label={t("panel.new")}
              title={t("panel.new")}
              onClick={() => {
                selectionGeneration.current++;
                setFresh(true);
                setConfirmDelete(false);
              }}
            >
              <Plus size={15} />
            </button>
            <button
              type="button"
              className="assistant-icon"
              aria-label={t("panel.delete")}
              title={t("panel.delete")}
              disabled={!conversation || fresh || !!running}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} />
            </button>
            <button
              type="button"
              className="assistant-icon"
              aria-label={t("panel.close")}
              title={t("panel.close")}
              onClick={() => onOpenChange(false)}
            >
              <X size={15} />
            </button>
          </header>
          {summaries.length > 1 && (
            <nav
              className="assistant-threads"
              aria-label={t("panel.conversations")}
            >
              {summaries.slice(0, 6).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-current={
                    !fresh && selectedId === item.id ? "true" : undefined
                  }
                  onClick={act(() => select(projectId!, item.id))}
                  title={item.title}
                >
                  {item.running && (
                    <span
                      className="assistant-thread-dot"
                      aria-label={t("panel.running")}
                    />
                  )}
                  {item.title}
                </button>
              ))}
            </nav>
          )}
          {confirmDelete && conversation && (
            <div className="assistant-confirm" role="alertdialog">
              <p>{t("panel.deleteConfirm", { title: conversation.title })}</p>
              <div>
                <button
                  type="button"
                  className="danger"
                  onClick={act(async () => {
                    await desktop.invoke("agent:deleteConversation", {
                      projectId: conversation.projectId,
                      id: conversation.id,
                    });
                    setConfirmDelete(false);
                    setConversation(null);
                    const items = await loadSummaries(conversation.projectId);
                    if (items[0])
                      await select(conversation.projectId, items[0].id);
                  })}
                >
                  {t("panel.deleteYes")}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)}>
                  {t("panel.cancel")}
                </button>
              </div>
            </div>
          )}
          <div className="assistant-list" ref={list}>
            {!projectId ? (
              <p className="assistant-empty">{t("panel.noProject")}</p>
            ) : fresh || !turns.length ? (
              <p className="assistant-empty">{t("panel.empty")}</p>
            ) : (
              turns.map((turn, index) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  latest={index === turns.length - 1}
                  onLocate={onLocate}
                  onFile={(path) =>
                    act(() =>
                      downloadAgentFile(
                        desktop.invoke,
                        turn.id,
                        path,
                        turn.projectId,
                      ),
                    )()
                  }
                  onCancel={act(() =>
                    desktop.invoke("agent:cancel", {
                      id: turn.id,
                      projectId: turn.projectId,
                      conversationId: turn.conversationId,
                    }),
                  )}
                  onUndo={act(async () =>
                    setConversation(
                      await desktop.invoke<AgentConversation>("agent:undo", {
                        projectId: turn.projectId,
                        conversationId: turn.conversationId,
                        id: turn.id,
                      }),
                    ),
                  )}
                  onPermission={(id, option) =>
                    act(() =>
                      desktop.invoke("agent:permission", {
                        id,
                        option,
                        conversation: true,
                        projectId: turn.projectId,
                        conversationId: turn.conversationId,
                      }),
                    )()
                  }
                />
              ))
            )}
          </div>
          <form
            className="assistant-form"
            onSubmit={(event) => {
              event.preventDefault();
              const prompt = draft.trim();
              if (!prompt) return;
              void send(prompt, panelTarget);
            }}
          >
            <div className="assistant-form-target">
              {reference && (
                <button
                  type="button"
                  className="assistant-chip"
                  onClick={() => setReference(null)}
                  title={t("reference.remove")}
                >
                  <LocateFixed size={12} />
                  {t(
                    reference.kind === "point"
                      ? "reference.point"
                      : "reference.region",
                  )}{" "}
                  <X size={12} />
                </button>
              )}
              <span className="assistant-chip is-static">
                {targetLabel(t, panelTarget, pageTitle)}
              </span>
              {panelTarget && (
                <button
                  type="button"
                  className="assistant-icon"
                  aria-label={t("target.remove")}
                  onClick={() => setPanelTarget(null)}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="assistant-input">
              <button
                type="button"
                className="assistant-icon assistant-reference-button"
                aria-label={t("reference.pick")}
                title={t("reference.pick")}
                disabled={!pageId}
                onClick={pickReference}
              >
                <LocateFixed size={17} />
              </button>
              <textarea
                rows={3}
                value={draft}
                disabled={!projectId || !pageId}
                placeholder={t("panel.placeholder")}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button
                type="submit"
                className="assistant-send"
                aria-label={t("panel.send")}
                disabled={
                  busy ||
                  (!fresh && !!running) ||
                  !draft.trim() ||
                  !projectId ||
                  !pageId
                }
              >
                {busy ? (
                  <Loader2 size={14} className="studio-spin" />
                ) : (
                  <ArrowUp size={14} />
                )}
              </button>
            </div>
            <footer>
              {destination}
              <button
                type="button"
                className="assistant-agent"
                title={t("panel.settings")}
                onClick={onOpenSettings}
              >
                <Settings2 size={12} aria-hidden="true" />
                {agentLabel || t("panel.settings")}
              </button>
            </footer>
            {(error || messageDraft.persistenceError) && !composer && (
              <p className="assistant-error" role="alert">
                {error || messageDraft.persistenceError}
              </p>
            )}
          </form>
        </aside>
      )}
    </AssistantContext.Provider>
  );
}

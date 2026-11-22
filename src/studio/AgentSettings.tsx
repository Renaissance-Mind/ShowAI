import { useNotify } from "../problems/toast-context";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  CircleAlert,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from "../ui/icons";
import { SettingsPath } from "./SettingsPath";
import Dialog from "../ui/Dialog";
import Select from "../ui/Select";
import { desktop, errorMessage } from "../host/bridge";
import type {
  AgentHostStatus,
  AgentSettings as Configuration,
  AgentTask,
  ModelSource,
} from "../agent-host/types";
import { sourcePresets } from "../agent-host/types";
import AgentBrandIcon from "./AgentBrandIcon";
import ServerResources from "./ServerResources";
import { useTranslator } from "../i18n/react";
import strings from "../i18n/messages/agentSettings";
import common from "../i18n/messages/common";
import { PendingNotice } from "../ui/PendingNotice";
import { downloadAgentFile, messageLinks } from "./assistant/message-links";
import "./agent-settings.css";
import {
  AgentExecutionPicker,
  RemoteDeviceSettings,
  remoteExecution,
} from "./AgentExecution";
import { AGENT_SETUP_EVENT, takeAgentSetup } from "./AgentReadiness";
import { useSessionDraft } from "./session-draft";

const KNOWN_RUNTIME_FAILURES = new Set([
  "network",
  "registry",
  "integrity",
  "disk",
  "verify",
  "unknown",
]);

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MiB`
    : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

function TaskResult({
  task,
  onCancel,
  onPermission,
  onFile,
}: {
  task: AgentTask;
  onCancel: () => void;
  onPermission: (id: string, option: string | null) => void;
  onFile: (path: string) => void;
}) {
  const t = useTranslator(strings);
  const messages = task.events.filter((event) => event.type === "message");
  const tools = task.events.filter((event) => event.type === "tool");
  return (
    <article className="agent-task" aria-label={task.label}>
      <header>
        <span className={`agent-state state-${task.state}`}>
          {t(`state.${task.state}`)}
        </span>
        <span>{task.label}</span>
        {task.state === "running" && (
          <button type="button" className="settings-button" onClick={onCancel}>
            <Square size={12} />
            {t("stop")}
          </button>
        )}
      </header>
      {messages.length > 0 && (
        <div className="agent-answer">
          {messageLinks(messages.map((event) => event.text).join("\n"), onFile)}
        </div>
      )}
      {task.approvals?.map((approval) => (
        <div className="agent-approval" key={approval.id}>
          <p>{approval.title}</p>
          <div className="agent-form-actions">
            {approval.options.map((option) => (
              <button
                type="button"
                className="settings-button"
                key={option.id}
                onClick={() => onPermission(approval.id, option.id)}
              >
                {option.name}
              </button>
            ))}
            <button
              type="button"
              className="settings-button"
              onClick={() => onPermission(approval.id, null)}
            >
              {t("cancelThisAction")}
            </button>
          </div>
        </div>
      ))}
      {task.error && (
        <p className="agent-error" role="alert">
          {task.error}
        </p>
      )}
      {tools.length > 0 && (
        <section className="agent-events">
          <h3 className="settings-section-heading">
            {t("eventLog", { count: tools.length })}
          </h3>
          <pre>{tools.map((event) => event.text).join("\n\n")}</pre>
        </section>
      )}
      {task.state === "running" && (
        <p className="settings-help" role="status">
          <Loader2 size={13} className="studio-spin" />{" "}
          {task.events.filter((event) => event.type === "status").at(-1)
            ?.text ?? t("running")}
        </p>
      )}
    </article>
  );
}

export default function AgentSettings({
  onAccounts,
}: {
  onAccounts?: () => void;
}) {
  const t = useTranslator(strings);
  const tc = useTranslator(common);
  const presetName = (provider: string, fallback: string) =>
    provider === "chatgpt"
      ? t("preset.chatgpt")
      : provider === "custom"
        ? t("preset.custom")
        : fallback;
  const [status, setStatus] = useState<AgentHostStatus | null>(null);
  const notify = useNotify();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [adding, setAdding] = useSessionDraft("agent-settings.adding", false);
  const [editing, setEditing] = useSessionDraft<ModelSource | null>(
      "agent-settings.source",
      null,
    ),
    [key, setKey] = useSessionDraft("agent-settings.apiKey", "");
  const [models, setModels] = useSessionDraft<{ id: string; name: string }[]>(
    "agent-settings.models",
    [],
  );
  const [taskId, setTaskId] = useState("");
  const sourceForm = useRef<HTMLFormElement>(null);
  const editingId = editing?.id;
  useEffect(() => {
    if (!editingId) return;
    const form = sourceForm.current;
    form?.scrollIntoView({ block: "nearest" });
    form?.querySelector("input")?.focus({ preventScroll: true });
  }, [editingId]);
  const mounted = useRef(true),
    settingsRef = useRef<Configuration | null>(null);
  const taskRef = useRef("");
  const latestStatus = useRef<AgentHostStatus | null>(null);
  const nextRemotePoll = useRef(0);
  const remoteStartUntil = useRef(0);
  const executionGeneration = useRef(0);
  const statusErrorText = useRef("");
  const statusError = useCallback((error: unknown) => {
    const code = (error as { code?: string }).code;
    if (code === "AGENT_STARTING") {
      if (!remoteStartUntil.current)
        remoteStartUntil.current = Date.now() + 120000;
      nextRemotePoll.current = Date.now() + 5000;
    } else {
      remoteStartUntil.current = 0;
      nextRemotePoll.current = Date.now() + 30000;
    }
    statusErrorText.current = errorMessage(error);
    setError(statusErrorText.current);
  }, []);
  taskRef.current = taskId;
  const choiceFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (busy) return;
    const choice = choiceFocusRef.current;
    choiceFocusRef.current = null;
    if (choice?.isConnected && document.activeElement === document.body)
      choice.focus();
  }, [busy]);
  const update = useCallback((next: AgentHostStatus) => {
    if (!mounted.current) return;
    settingsRef.current = next.settings;
    latestStatus.current = next;
    remoteStartUntil.current = 0;
    const previousError = statusErrorText.current;
    statusErrorText.current = "";
    if (previousError)
      setError((current) => (current === previousError ? "" : current));
    setStatus(next);
  }, []);
  const refresh = useCallback(async () => {
    const generation = executionGeneration.current;
    try {
      const next = await desktop.invoke<AgentHostStatus>("agent:status", {
        taskId: taskRef.current || undefined,
      });
      if (generation === executionGeneration.current) update(next);
    } catch (error) {
      if (generation === executionGeneration.current) throw error;
    }
  }, [update]);
  useEffect(() => {
    mounted.current = true;
    const generation = executionGeneration.current;
    void desktop
      .invoke<AgentHostStatus>("agent:scan")
      .then((next) => {
        if (generation === executionGeneration.current) update(next);
      })
      .catch((reason) => {
        if (generation === executionGeneration.current) statusError(reason);
      });
    const timer = setInterval(() => {
      const current = latestStatus.current;
      if (
        remoteExecution() &&
        (Date.now() < nextRemotePoll.current ||
          (Date.now() > remoteStartUntil.current &&
            (!current ||
              (current.authorization.state !== "pending" &&
                current.runtime.state !== "installing" &&
                !current.tasks.some((task) => task.state === "running")))))
      )
        return;
      void refresh().catch(statusError);
    }, 1200);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh, update, statusError]);
  const action = (work: () => Promise<void>) => async () => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const change = async (values: Partial<Configuration>) => {
    if (!settingsRef.current) return;
    update(
      await desktop.invoke<AgentHostStatus>("agent:settings", {
        settings: { ...settingsRef.current, ...values },
      }),
    );
  };
  const add = (provider: string) => {
    const preset = sourcePresets.find((item) => item.provider === provider)!;
    setEditing({
      id: crypto.randomUUID(),
      ...preset,
      name: presetName(preset.provider, preset.name),
      model: "",
    });
    setKey("");
    setModels([]);
    setAdding(false);
  };
  const setupIntent = useRef<(() => void) | null>(null);
  setupIntent.current = () => {
    if (!status || remoteExecution()) return;
    const intent = takeAgentSetup();
    if (!intent) return;
    void action(async () => {
      if (status.settings.mode !== "api") await change({ mode: "api" });
      if (intent === "chatgpt") {
        const existing = status.settings.sources.find(
          (source) => source.credential === "chatgpt",
        );
        if (existing) {
          setEditing({ ...existing });
          setKey("");
          setModels([]);
        } else add("chatgpt");
      }
      requestAnimationFrame(() =>
        document
          .getElementById("agent-sources-title")
          ?.scrollIntoView({ block: "start" }),
      );
    })();
  };
  const ready = !!status;
  useEffect(() => {
    if (ready) setupIntent.current?.();
    const listen = () => setupIntent.current?.();
    window.addEventListener(AGENT_SETUP_EVENT, listen);
    return () => window.removeEventListener(AGENT_SETUP_EVENT, listen);
  }, [ready]);
  const saveSource = async () => {
    if (!editing) return;
    const next = await desktop.invoke<AgentHostStatus>("agent:source", {
      source: editing,
      ...(key.trim() ? { apiKey: key } : {}),
    });
    setKey("");
    setModels([]);
    update(next);
    setEditing(null);
    notify(t("toast.sourceSaved"));
  };
  const test = async (localAgent?: string) => {
    const task = await desktop.invoke<AgentTask>("agent:start", {
      test: true,
      localAgent,
    });
    setTaskId(task.id);
    await refresh();
  };
  const selected = status?.settings.sources.find(
    (source) => source.id === status.settings.sourceId,
  );
  const editingExisting =
    !!editing &&
    !!status?.settings.sources.some((source) => source.id === editing.id);
  const managed = editingExisting
    ? status?.settings.sources.find((source) => source.id === editing!.id)
    : editing
      ? undefined
      : selected;
  const activeTask =
    status?.tasks.find((task) => task.id === taskId) ?? status?.tasks[0];
  const hasRunning = status?.tasks.some((task) => task.state === "running");
  const executionChanged = (changed = true) => {
    if (changed) {
      executionGeneration.current++;
      setEditing(null);
      setKey("");
      setModels([]);
      setTaskId("");
    }
    latestStatus.current = null;
    settingsRef.current = null;
    remoteStartUntil.current = 0;
    nextRemotePoll.current = 0;
    setStatus(null);
    void refresh().catch(statusError);
  };
  if (!status)
    return (
      <div className="agent-settings">
        <AgentExecutionPicker onChange={executionChanged} disabled={busy} />
        {error ? (
          <div
            role="alert"
            className="settings-callout"
            data-tone="error"
          >
            <CircleAlert size={16} aria-hidden="true" />
            <span>{error}</span>
            <button
              type="button"
              className="settings-button"
              disabled={busy}
              onClick={action(() => refresh().catch(statusError))}
            >
              {tc("retry")}
            </button>
          </div>
        ) : (
          <PendingNotice label={t("reading")} lines={4} minHeight={260} />
        )}
        <RemoteDeviceSettings onAccounts={onAccounts} />
      </div>
    );
  const deviceExecution =
    remoteExecution() && status.executionKind === "device";
  const cloudExecution = remoteExecution() && status.executionKind === "cloud";
  if (remoteExecution() && status.executionKind === "mac")
    return (
      <div className="agent-settings">
        <AgentExecutionPicker onChange={executionChanged} disabled={busy} />
        <div className="settings-callout">
          <p>{t("remoteMacHelp")}</p>
        </div>
        {error && (
          <div className="settings-callout" data-tone="error" role="alert">
            <CircleAlert size={15} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>
    );

  const installedAgents = status.agents.filter((agent) => !!agent.path);
  const runtimeFailureCode = KNOWN_RUNTIME_FAILURES.has(
    status.runtime.failure ?? "",
  )
    ? status.runtime.failure!
    : "unknown";
  const runtimeFailureText = t(
    `runtime.failure.${runtimeFailureCode}` as Parameters<typeof t>[0],
  );

  const renderSourceForm = () => {
    if (!editing) return null;
    return (
      <form
        ref={sourceForm}
        className="agent-source-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action(saveSource)();
        }}
      >
        <div className="agent-source-form-heading">
          <AgentBrandIcon brand={editing.provider} />
          <h3>
            {presetName(
              editing.provider,
              sourcePresets.find((preset) => preset.provider === editing.provider)
                ?.name ?? editing.name,
            )}
          </h3>
        </div>
        <div className="agent-source-fields">
          <div className="agent-source-names">
            <label>
              <span>{t("name")}</span>
              <input
                className="showai-input"
                required
                value={editing.name}
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
              />
            </label>
            <label>
              <span>{t("modelName")}</span>
              <input
                className="showai-input"
                list="agent-model-options"
                value={editing.model}
                onChange={(event) =>
                  setEditing({ ...editing, model: event.target.value })
                }
                placeholder={t("modelPlaceholder")}
              />
              <datalist id="agent-model-options">
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </datalist>
            </label>
          </div>
          {editing.credential === "api-key" && !editing.hosted && (
            <>
              <label>
                <span>{t("apiUrl")}</span>
                <input
                  className="showai-input"
                  type="url"
                  required
                  value={editing.baseUrl}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      baseUrl: event.target.value,
                    })
                  }
                  placeholder="https://example.com/v1"
                />
              </label>
              {!deviceExecution && (
                <label>
                  <span>{t("protocol")}</span>
                  <Select
                    value={editing.protocol}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        protocol: event.target.value as ModelSource["protocol"],
                      })
                    }
                  >
                    <option value="responses">Responses API</option>
                    <option value="chat">Chat Completions</option>
                  </Select>
                </label>
              )}
              <label>
                <span>{t("apiKey")}</span>
                <input
                  className="showai-input"
                  type="password"
                  autoComplete="new-password"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder={
                    editing.apiKeyPresent ? t("apiKeyKeep") : t("apiKeyEnter")
                  }
                />
              </label>
            </>
          )}
        </div>
        {editing.credential === "chatgpt" && (
          <p className="settings-help">
            {t(cloudExecution ? "cloudChatgptHelp" : "chatgptHelp")}
          </p>
        )}
        <div className="agent-form-actions">
          <button
            className="settings-button settings-primary-button"
            type="submit"
            disabled={busy}
          >
            {t("saveSource")}
          </button>
          {editingExisting && (
            <button
              className="settings-button"
              type="button"
              disabled={busy}
              onClick={action(async () => {
                setModels(
                  await desktop.invoke("agent:models", {
                    id: editing.id,
                  }),
                );
                notify(t("toast.modelsLoaded"));
              })}
            >
              {t("fetchModels")}
            </button>
          )}
          <button
            className="settings-button"
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(null);
              setKey("");
              setModels([]);
            }}
          >
            {tc("cancel")}
          </button>
        </div>
      </form>
    );
  };

  const renderManagedActions = () => {
    if (!managed) return null;
    return (
      <div className="agent-form-actions">
        {managed.credential === "chatgpt" &&
          !managed.hosted &&
          !cloudExecution && (
            <>
              <button
                type="button"
                className="settings-button"
                disabled={busy || status.authorization.state === "pending"}
                onClick={action(async () => {
                  const result = await desktop.invoke<{ url?: string }>(
                    "agent:authorize",
                    { id: managed.id },
                  );
                  if (result.url)
                    window.open(result.url, "_blank", "noopener,noreferrer");
                  await refresh();
                })}
              >
                {managed.connected
                  ? t("reauthorizeChatgpt")
                  : t("continueWithChatgpt")}
              </button>
              {managed.connected && (
                <button
                  type="button"
                  className="settings-button"
                  disabled={busy || hasRunning}
                  onClick={action(async () => {
                    update(
                      await desktop.invoke("agent:disconnect", {
                        id: managed.id,
                      }),
                    );
                  })}
                >
                  {t("disconnect")}
                </button>
              )}
              <a
                className="settings-button"
                href="https://chatgpt.com/settings/usage"
                target="_blank"
                rel="noreferrer"
              >
                {t("managePlanUsage")}
              </a>
            </>
          )}
        <button
          type="button"
          className="settings-button"
          disabled={
            busy ||
            hasRunning ||
            status.runtime.state !== "ready" ||
            !(
              managed.model &&
              (managed.apiKeyPresent ||
                managed.planEnabled ||
                /^(?:http:\/\/)?(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/)/.test(
                  managed.baseUrl,
                ))
            )
          }
          onClick={action(async () => {
            if (managed.id !== status.settings.sourceId)
              await change({ sourceId: managed.id });
            await test();
          })}
        >
          {t("testModel")}
        </button>
        <button
          type="button"
          className="settings-button settings-danger-button"
          disabled={busy || hasRunning || (deviceExecution && !!managed.hosted)}
          onClick={action(async () => {
            update(
              await desktop.invoke("agent:removeSource", {
                id: managed.id,
              }),
            );
            setEditing(null);
            setKey("");
            setModels([]);
          })}
        >
          <Trash2 size={13} aria-hidden="true" />
          {t("removeSource")}
        </button>
      </div>
    );
  };

  const sourceModalOpen = adding || !!editing;
  const closeSourceModal = () => {
    setAdding(false);
    setEditing(null);
    setKey("");
    setModels([]);
  };

  return (
    <div className="agent-settings">
      <AgentExecutionPicker onChange={executionChanged} disabled={busy} />
      {error && (
        <div
          className="settings-callout agent-inline-alert"
          data-tone="error"
          role="alert"
        >
          <CircleAlert size={15} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {!remoteExecution() ? (
        <section className="settings-group" aria-labelledby="agent-mode-title">
          <h2 id="agent-mode-title">{t("mode")}</h2>
          <div className="settings-card agent-mode-shell">
            <div className="agent-mode-header">
              <div
                className="agent-mode-switcher"
                role="radiogroup"
                aria-label={t("modeLabel")}
              >
                {(
                  [
                    { id: "local", title: "mode.local.title" },
                    { id: "api", title: "mode.api.title" },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    role="radio"
                    aria-checked={status.settings.mode === mode.id}
                    disabled={
                      busy ||
                      (remoteExecution() &&
                        (cloudExecution || deviceExecution) &&
                        mode.id === "local")
                    }
                    onClick={(event) => {
                      choiceFocusRef.current = event.currentTarget;
                      void action(() => change({ mode: mode.id }))();
                    }}
                    onKeyDown={(event) => {
                      if (
                        [
                          "ArrowLeft",
                          "ArrowRight",
                          "ArrowUp",
                          "ArrowDown",
                        ].includes(event.key)
                      ) {
                        event.preventDefault();
                        const next = mode.id === "local" ? "api" : "local";
                        const buttons =
                          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                            "button[role=radio]",
                          );
                        const choice = buttons?.[next === "local" ? 0 : 1];
                        choiceFocusRef.current = choice ?? null;
                        void action(() => change({ mode: next }))();
                        choice?.focus();
                      }
                    }}
                  >
                    <Bot size={15} aria-hidden="true" />
                    <span>{t(mode.title)}</span>
                  </button>
                ))}
              </div>
              <p className="agent-mode-caption">
                {t(
                  status.settings.mode === "local"
                    ? "mode.local.text"
                    : "mode.api.text",
                )}
              </p>
            </div>

            <div className="agent-mode-body">
              {status.settings.mode === "local" ? (
                <div
                  className="settings-card-section"
                  aria-labelledby="local-agent-title"
                >
                  <div className="agent-subblock-header">
                    <div>
                      <h3
                        id="local-agent-title"
                        className="agent-subblock-title"
                      >
                        {t("availableAgents")}
                      </h3>
                      <p className="settings-help">{t("localHelp")}</p>
                    </div>
                    <button
                      type="button"
                      className="settings-button"
                      disabled={busy}
                      onClick={action(async () =>
                        update(
                          await desktop.invoke<AgentHostStatus>("agent:scan"),
                        ),
                      )}
                    >
                      <RefreshCw size={13} />
                      {t("rescan")}
                    </button>
                  </div>
                  {installedAgents.length > 0 ? (
                    <div
                      className="agent-list"
                      role="group"
                      aria-label={t("chooseLocalAgent")}
                    >
                      {installedAgents.map((agent) => (
                        <article
                          className="agent-card"
                          key={agent.id}
                          data-selected={status.settings.localAgent === agent.id}
                          data-unavailable={!agent.path}
                        >
                          <label>
                            <AgentBrandIcon brand={agent.id} />
                            <span className="agent-card-name">
                              <strong>{agent.name}</strong>
                              <small>{agent.version || t("notInstalled")}</small>
                            </span>
                            {status.settings.localAgent === agent.id && (
                              <span className="settings-badge" data-tone="accent">
                                {t("current")}
                              </span>
                            )}
                            <input
                              className="showai-radio"
                              type="radio"
                              name="local-agent"
                              aria-label={agent.name}
                              aria-describedby={`agent-detail-${agent.id}`}
                              checked={status.settings.localAgent === agent.id}
                              disabled={!agent.path || busy}
                              onChange={(event) => {
                                if (document.activeElement === event.currentTarget)
                                  choiceFocusRef.current = event.currentTarget;
                                void action(() =>
                                  change({ localAgent: agent.id }),
                                )();
                              }}
                            />
                          </label>
                          {agent.detail && (
                            <p id={`agent-detail-${agent.id}`}>{agent.detail}</p>
                          )}
                          <div className="agent-card-footer">
                            <span
                              className="settings-badge"
                              data-tone={
                                agent.callable === true
                                  ? "ok"
                                  : agent.callable === false
                                    ? "error"
                                    : undefined
                              }
                            >
                              {agent.callable === true
                                ? t("availability.passed")
                                : agent.callable === false
                                  ? t("availability.failed")
                                  : agent.auth === "ready"
                                    ? t("availability.ready")
                                    : agent.path
                                      ? t("availability.untested")
                                      : t("availability.missing")}
                            </span>
                            <button
                              type="button"
                              className="settings-button"
                              aria-label={t("testAgent", { name: agent.name })}
                              disabled={!agent.path || busy || hasRunning}
                              onClick={action(() => test(agent.id))}
                            >
                              {t("testConnection")}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="settings-row settings-row-compact">
                      <div className="settings-row-text">
                        <h3>{t("noLocalAgentsTitle")}</h3>
                        <p>{t("noLocalAgentsDetail")}</p>
                      </div>
                      <button
                        type="button"
                        className="settings-button settings-primary-button"
                        disabled={busy}
                        onClick={action(() => change({ mode: "api" }))}
                      >
                        {t("switchToApiMode")}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div
                    className="settings-card-section"
                    aria-labelledby="agent-runtime-title"
                  >
                    <h3 id="agent-runtime-title" className="agent-subblock-title">
                      {t("runtime")}
                    </h3>
                    <div className="settings-row settings-row-compact">
                      <div className="settings-row-text">
                        <h3>
                          {t("runtimeName")}
                          {status.runtime.version && (
                            <span className="agent-version">
                              {status.runtime.version}
                            </span>
                          )}
                          <span
                            className="settings-badge"
                            data-tone={
                              status.runtime.state === "ready"
                                ? "ok"
                                : status.runtime.state === "failed"
                                  ? "error"
                                  : status.runtime.state === "installing"
                                    ? "warn"
                                    : undefined
                            }
                          >
                            {status.runtime.stage
                              ? t(`runtime.stage.${status.runtime.stage}`)
                              : status.runtime.progress ||
                                t(
                                  status.runtime.state === "ready"
                                    ? "runtime.stage.installed"
                                    : status.runtime.state === "failed"
                                      ? "runtime.stage.failed"
                                      : status.runtime.state === "installing"
                                        ? "runtime.installing"
                                        : "runtime.stage.absent",
                                )}
                          </span>
                        </h3>
                        <p>
                          {t("runtimeHelp")}
                          {status.runtime.state !== "ready" &&
                            ` ${t("runtime.size")}`}
                          {status.runtime.state === "installing" &&
                            !!status.runtime.received &&
                            ` · ${
                              status.runtime.total
                                ? t("runtime.bytes", {
                                    received: formatBytes(
                                      status.runtime.received,
                                    ),
                                    total: formatBytes(status.runtime.total),
                                  })
                                : t("runtime.bytesUnknown", {
                                    received: formatBytes(
                                      status.runtime.received,
                                    ),
                                  })
                            }`}
                        </p>
                        {status.runtime.state === "installing" && (
                          <progress
                            className="agent-runtime-progress"
                            aria-label={t("runtime.installing")}
                            {...(status.runtime.total && status.runtime.received
                              ? {
                                  max: status.runtime.total,
                                  value: status.runtime.received,
                                }
                              : {})}
                          />
                        )}
                      </div>
                      <button
                        type="button"
                        className={`settings-button${status.runtime.state !== "ready" ? " settings-primary-button" : ""}`}
                        disabled={
                          busy ||
                          status.runtime.state === "installing" ||
                          hasRunning
                        }
                        onClick={action(async () => {
                          update(await desktop.invoke("agent:install"));
                        })}
                      >
                        {status.runtime.state === "installing" ? (
                          <Loader2 size={13} className="studio-spin" />
                        ) : (
                          <Download size={13} />
                        )}
                        {status.runtime.state === "ready"
                          ? t("runtime.update")
                          : status.runtime.state === "installing"
                            ? t("runtime.installing")
                            : status.runtime.state === "failed"
                              ? t("runtime.retry")
                              : t("runtime.install")}
                      </button>
                    </div>
                    {status.runtime.state === "failed" && (
                      <div
                        className="settings-callout"
                        data-tone="error"
                        role="alert"
                      >
                        <CircleAlert size={15} aria-hidden="true" />
                        <div>
                          <p>{runtimeFailureText}</p>
                          {status.runtime.error &&
                            status.runtime.error.trim() !==
                              runtimeFailureText.trim() && (
                              <section className="agent-events">
                                <h4 className="settings-section-heading">
                                  {t("runtime.failureDetail")}
                                </h4>
                                <pre>{status.runtime.error}</pre>
                              </section>
                            )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div
                    className="settings-card-section"
                    aria-labelledby="agent-sources-title"
                  >
                    <div className="agent-subblock-header">
                      <h3
                        id="agent-sources-title"
                        className="agent-subblock-title"
                      >
                        {t("modelSources")}
                      </h3>
                      <button
                        type="button"
                        className="settings-button"
                        disabled={busy}
                        onClick={() => {
                          setAdding(true);
                          setEditing(null);
                          setKey("");
                          setModels([]);
                        }}
                      >
                        <Plus size={14} aria-hidden="true" />
                        {t("addSource")}
                      </button>
                    </div>
                    <div className="settings-row settings-row-compact">
                      <div className="settings-row-text">
                        <h3>{t("currentSource")}</h3>
                      </div>
                      <div className="settings-select">
                        <Select
                          aria-label={t("currentSourceLabel")}
                          value={status.settings.sourceId}
                          disabled={busy}
                          onChange={(event) => {
                            setEditing(null);
                            void action(() =>
                              change({ sourceId: event.target.value }),
                            )();
                          }}
                        >
                          <option value="">{t("chooseSource")}</option>
                          {status.settings.sources.map((source) => (
                            <option key={source.id} value={source.id}>
                              {source.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>

                    {selected && (
                      <div className="agent-current-source-box">
                        <div className="agent-source-summary">
                          <AgentBrandIcon brand={selected.provider} />
                          <div className="agent-source-identity">
                            <strong>
                              {selected.name}
                              <span
                                className="settings-badge"
                                data-tone={
                                  selected.credential === "chatgpt"
                                    ? selected.planEnabled
                                      ? "ok"
                                      : "warn"
                                    : selected.apiKeyPresent
                                      ? "ok"
                                      : "warn"
                                }
                              >
                                {selected.credential === "chatgpt"
                                  ? selected.planEnabled
                                    ? t("chatgptAuthorized")
                                    : t("chatgptPending")
                                  : selected.apiKeyPresent
                                    ? t("apiKeySaved")
                                    : t("apiKeyMissing")}
                              </span>
                            </strong>
                            <small>
                              {selected.model || t("noModel")}
                              {selected.account ? ` · ${selected.account}` : ""}
                              {selected.hosted
                                ? ` · ${selected.hosted.serverName}`
                                : ""}
                            </small>
                          </div>
                          <button
                            type="button"
                            className="settings-button"
                            disabled={busy}
                            onClick={() => {
                              setAdding(false);
                              setEditing({ ...selected });
                              setKey("");
                              setModels([]);
                            }}
                          >
                            {t("manageSource")}
                          </button>
                        </div>

                        {renderManagedActions()}

                        {activeTask?.state === "failed" &&
                          managed &&
                          activeTask.sourceId === managed.id && (
                            <p className="agent-test-error" role="status">
                              {activeTask.problem?.code === "rate_limited" ||
                              /\b429\b/.test(activeTask.error ?? "")
                                ? t("modelRetryAfterLimit")
                                : t("modelTestFailed")}
                            </p>
                          )}

                        {status.authorization.state === "pending" && (
                          <div className="settings-callout" role="status">
                            <Loader2 size={14} className="studio-spin" />
                            <span>{t("authPending")}</span>
                            <button
                              type="button"
                              className="settings-button"
                              onClick={action(async () =>
                                update(await desktop.invoke("agent:cancelAuth")),
                              )}
                            >
                              {t("cancelAuth")}
                            </button>
                          </div>
                        )}

                        {status.authorization.error && (
                          <div
                            className="settings-callout"
                            data-tone="error"
                            role="alert"
                          >
                            <CircleAlert size={15} aria-hidden="true" />
                            <div>
                              <p>{t("authorizationIncomplete")}</p>
                              <section className="agent-events">
                                <h4 className="settings-section-heading">
                                  {t("runtime.failureDetail")}
                                </h4>
                                <pre>{status.authorization.error}</pre>
                              </section>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {status.settings.mode === "api" && !deviceExecution && (
            <section
              className="settings-group"
              aria-label={t("resources.title")}
            >
              <h2>{t("resources.title")}</h2>
              <ServerResources
                selected={selected}
                disabled={busy || !!hasRunning}
                update={update}
              />
            </section>
          )}
        </section>
      ) : (
        status.settings.mode === "api" && (
          <section
            className="settings-group"
            aria-labelledby="agent-sources-title"
          >
            <h2 id="agent-sources-title">
              {t(deviceExecution ? "modelName" : "modelSources")}
            </h2>
            <div
              className="device-model-grid"
              role="group"
              aria-label={t("modelName")}
            >
              {status.settings.sources
                .filter(
                  (source) => source.apiKeyPresent || source.planEnabled,
                )
                .map((source) => (
                  <article
                    className="device-model-card"
                    key={source.id}
                    data-active={source.id === status.settings.sourceId}
                  >
                    <button
                      type="button"
                      className="device-model-select"
                      aria-pressed={source.id === status.settings.sourceId}
                      disabled={busy || !!hasRunning}
                      onClick={action(() => change({ sourceId: source.id }))}
                    >
                      <span className="device-model-brand">
                        <AgentBrandIcon brand={source.provider} />
                      </span>
                      <strong>{source.name}</strong>
                      <span className="device-model-name">
                        {source.model || t("noModel")}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="device-model-configure"
                      disabled={busy}
                      onClick={() => {
                        setEditing({ ...source });
                        setKey("");
                        setModels([]);
                        setAdding(false);
                      }}
                    >
                      {t("configure")}
                    </button>
                  </article>
                ))}
              <button
                type="button"
                className="device-model-add"
                disabled={busy}
                onClick={() => {
                  setAdding(true);
                  setEditing(null);
                  setKey("");
                }}
              >
                <Plus size={22} />
                <span>{t("addSource")}</span>
              </button>
            </div>
          </section>
        )
      )}

      {sourceModalOpen && (
        <Dialog
          title={
            editing
              ? editingExisting
                ? t("manageSource")
                : t("addSource")
              : t("addModelSource")
          }
          wide={!editing}
          className={editing ? "agent-edit-source-dialog" : undefined}
          onClose={closeSourceModal}
        >
          <div className="studio-dialog-body studio-dialog-form">
            {editing ? (
              <>
                {renderSourceForm()}
                {editingExisting && deviceExecution && renderManagedActions()}
              </>
            ) : (
              <>
                <p className="settings-help">{t("addSourceHint")}</p>
                <div
                  className="agent-presets"
                  aria-label={t("addModelSource")}
                >
                  {sourcePresets
                    .filter((preset) =>
                      deviceExecution
                        ? preset.provider === "deepseek"
                        : !cloudExecution || preset.credential !== "chatgpt",
                    )
                    .map((preset) => (
                      <button
                        type="button"
                        className="agent-preset"
                        key={preset.provider}
                        disabled={busy}
                        onClick={() => add(preset.provider)}
                      >
                        <AgentBrandIcon brand={preset.provider} />
                        <span>
                          <strong>
                            {presetName(preset.provider, preset.name)}
                          </strong>
                          <small>
                            {preset.credential === "chatgpt"
                              ? t("presetHint.account")
                              : preset.provider === "custom"
                                ? t("presetHint.custom")
                                : t("presetHint.apiKey")}
                          </small>
                        </span>
                        <Plus size={14} aria-hidden="true" />
                      </button>
                    ))}
                </div>
                {cloudExecution && (
                  <p className="settings-help">{t("cloudChatgptHelp")}</p>
                )}
              </>
            )}
          </div>
        </Dialog>
      )}

      {taskId && activeTask && (
        <Dialog
          title={t("testResultTitle")}
          wide
          onClose={() => setTaskId("")}
        >
          <div className="studio-dialog-body">
            <TaskResult
              task={activeTask}
              onFile={(path) =>
                void action(() =>
                  downloadAgentFile(desktop.invoke, activeTask.id, path),
                )()
              }
              onPermission={(id, option) =>
                void action(async () =>
                  update(
                    await desktop.invoke("agent:permission", { id, option }),
                  ),
                )()
              }
              onCancel={() =>
                void action(async () =>
                  update(
                    await desktop.invoke("agent:cancel", {
                      id: activeTask.id,
                    }),
                  ),
                )()
              }
            />
          </div>
        </Dialog>
      )}

      <RemoteDeviceSettings onAccounts={onAccounts} />

      {!remoteExecution() && (
        <section
          className="settings-group agent-storage"
          aria-labelledby="agent-storage-title"
        >
          <h2 id="agent-storage-title">{t("storage")}</h2>
          <div className="settings-card">
            {(
              [
                [
                  "taskWorkspace",
                  status.workspaceRoot,
                ],
                [
                  "credentialRoot",
                  status.credentialRoot,
                ],
              ] as const
            ).map(([labelKey, directory]) => (
              <div className="settings-card-section" key={labelKey}>
                <div className="settings-row-text">
                  <h3>{t(labelKey).replace(/[：:]\s*$/, "")}</h3>
                </div>
                <SettingsPath
                  value={directory}
                  copyLabel={`${t("copyPath")} ${t(labelKey).replace(/[：:]\s*$/, "")}`}
                  copiedLabel={t("pathCopied")}
                  onCopy={() =>
                    desktop.invoke("clipboard:write", { text: directory }).then(
                      () => {
                        notify(t("pathCopied"));
                        return true;
                      },
                      (reason) => {
                        setError(errorMessage(reason));
                        return false;
                      },
                    )
                  }
                />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

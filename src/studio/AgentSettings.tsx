import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from "../ui/icons";
import { desktop, errorMessage } from "./bridge";
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
import { downloadAgentFile, messageLinks } from "./assistant/message-links";
import "./agent-settings.css";
import {
  AgentExecutionPicker,
  RemoteDeviceSettings,
  remoteExecution,
} from "./AgentExecution";

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
          <button className="settings-button" onClick={onCancel}>
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
                className="settings-button"
                key={option.id}
                onClick={() => onPermission(approval.id, option.id)}
              >
                {option.name}
              </button>
            ))}
            <button
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
        <details className="agent-events">
          <summary>{t("eventLog", { count: tools.length })}</summary>
          <pre>{tools.map((event) => event.text).join("\n\n")}</pre>
        </details>
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

export default function AgentSettings() {
  const t = useTranslator(strings);
  const tc = useTranslator(common);
  // Built-in presets carry Chinese names; show and seed them in the UI language.
  const presetName = (provider: string, fallback: string) =>
    provider === "chatgpt"
      ? t("preset.chatgpt")
      : provider === "custom"
        ? t("preset.custom")
        : fallback;
  const [status, setStatus] = useState<AgentHostStatus | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<ModelSource | null>(null),
    [key, setKey] = useState("");
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [taskId, setTaskId] = useState("");
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
    setNotice("");
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
  };
  const saveSource = async () => {
    if (!editing) return;
    const next = await desktop.invoke<AgentHostStatus>("agent:source", {
      source: editing,
      ...(key.trim() ? { apiKey: key } : {}),
    });
    setKey("");
    update(next);
    setEditing(null);
    setNotice(t("toast.sourceSaved"));
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
  const activeTask =
    status?.tasks.find((task) => task.id === taskId) ?? status?.tasks[0];
  const hasRunning = status?.tasks.some((task) => task.state === "running");
  const apiReady =
    !!selected?.model &&
    (selected.credential === "chatgpt"
      ? selected.planEnabled
      : selected.apiKeyPresent ||
        /^(?:http:\/\/)?(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/)/.test(
          selected.baseUrl,
        ));
  const executionChanged = (changed = true) => {
    if (changed) {
      executionGeneration.current++;
      setEditing(null);
      setKey("");
      setModels([]);
      setTaskId("");
      setNotice("");
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
        <p role="status">{t("reading")}</p>
        {error && (
          <p role="alert" className="agent-error">
            {error}
          </p>
        )}
      </div>
    );
  if (remoteExecution() && status.executionKind === "mac")
    return (
      <div className="agent-settings">
        <AgentExecutionPicker onChange={executionChanged} disabled={busy} />
        <p className="settings-help">{t("remoteMacHelp")}</p>
        {error && (
          <p role="alert" className="agent-error">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <div className="agent-settings">
      <AgentExecutionPicker onChange={executionChanged} disabled={busy} />
      <RemoteDeviceSettings />
      <section className="settings-group" aria-labelledby="agent-mode-title">
        <h2 id="agent-mode-title">{t("mode")}</h2>
        <div
          className="agent-modes"
          role="radiogroup"
          aria-label={t("modeLabel")}
        >
          {(
            [
              {
                id: "local",
                title: "mode.local.title",
                text: "mode.local.text",
              },
              {
                id: "api",
                title: "mode.api.title",
                text: "mode.api.text",
              },
            ] as const
          ).map((mode) => (
            <button
              key={mode.id}
              role="radio"
              aria-checked={status.settings.mode === mode.id}
              disabled={
                busy ||
                (remoteExecution() &&
                  status.executionKind === "cloud" &&
                  mode.id === "local")
              }
              onClick={(event) => {
                choiceFocusRef.current = event.currentTarget;
                void action(() => change({ mode: mode.id }))();
              }}
              onKeyDown={(event) => {
                if (
                  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    event.key,
                  )
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
              <span>
                <Bot size={17} />
                {t(mode.title)}
                {status.settings.mode === mode.id && <Check size={15} />}
              </span>
              <small>{t(mode.text)}</small>
            </button>
          ))}
        </div>
      </section>
      {status.settings.mode === "local" ? (
        <section className="settings-group" aria-labelledby="local-agent-title">
          <h2 id="local-agent-title">{t("availableAgents")}</h2>
          <div className="settings-row">
            <p className="settings-help">{t("localHelp")}</p>
            <button
              className="settings-button"
              disabled={busy}
              onClick={action(async () =>
                update(await desktop.invoke<AgentHostStatus>("agent:scan")),
              )}
            >
              <RefreshCw size={13} />
              {t("rescan")}
            </button>
          </div>
          <div
            className="agent-list"
            role="group"
            aria-label={t("chooseLocalAgent")}
          >
            {status.agents.map((agent) => (
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
                    <span className="agent-current">{t("current")}</span>
                  )}
                  <input
                    type="radio"
                    name="local-agent"
                    aria-label={agent.name}
                    aria-describedby={`agent-detail-${agent.id}`}
                    checked={status.settings.localAgent === agent.id}
                    disabled={!agent.path || busy}
                    onChange={(event) => {
                      if (document.activeElement === event.currentTarget)
                        choiceFocusRef.current = event.currentTarget;
                      void action(() => change({ localAgent: agent.id }))();
                    }}
                  />
                </label>
                <p id={`agent-detail-${agent.id}`}>{agent.detail}</p>
                <div className="agent-card-footer">
                  <span
                    className={`agent-availability ${agent.callable === true ? "verified" : ""}`}
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
        </section>
      ) : (
        <>
          <section
            className="settings-group"
            aria-labelledby="agent-sources-title"
          >
            <h2 id="agent-sources-title">{t("modelSources")}</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <h3>{t("currentSource")}</h3>
              </div>
              <div className="settings-select">
                <select
                  aria-label={t("currentSourceLabel")}
                  value={status.settings.sourceId}
                  disabled={busy}
                  onChange={(event) =>
                    void action(() =>
                      change({ sourceId: event.target.value }),
                    )()
                  }
                >
                  <option value="">{t("chooseSource")}</option>
                  {status.settings.sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
            </div>
            {selected && (
              <div className="agent-source-summary">
                <AgentBrandIcon brand={selected.provider} />
                <div className="agent-source-identity">
                  <strong>{selected.name}</strong>
                  <small>
                    {selected.model || t("noModel")}
                    {selected.account ? ` · ${selected.account}` : ""}
                  </small>
                  <small>
                    {selected.hosted ? `${selected.hosted.serverName} · ` : ""}
                    {selected.credential === "chatgpt"
                      ? selected.planEnabled
                        ? t("chatgptAuthorized")
                        : t("chatgptPending")
                      : selected.apiKeyPresent
                        ? t("apiKeySaved")
                        : t("apiKeyMissing")}
                  </small>
                </div>
                <button
                  className="settings-button"
                  disabled={busy}
                  onClick={() => {
                    setEditing({ ...selected });
                    setKey("");
                    setModels([]);
                  }}
                >
                  {t("manageSource")}
                </button>
              </div>
            )}
            <div className="agent-presets" aria-label={t("addModelSource")}>
              {sourcePresets.map((preset) => (
                <button
                  className="agent-preset"
                  key={preset.provider}
                  disabled={busy}
                  onClick={() => add(preset.provider)}
                >
                  <AgentBrandIcon brand={preset.provider} />
                  <span>
                    <strong>{presetName(preset.provider, preset.name)}</strong>
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
            <ServerResources
              selected={selected}
              disabled={busy || !!hasRunning}
              update={update}
            />
            {editing && (
              <form
                className="agent-source-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void action(saveSource)();
                }}
              >
                <div className="agent-source-form-heading">
                  <AgentBrandIcon brand={editing.provider} />
                  <div>
                    <h3>
                      {status.settings.sources.some(
                        (source) => source.id === editing.id,
                      )
                        ? t("manageSource")
                        : t("addSource")}
                    </h3>
                    <p>
                      {presetName(
                        editing.provider,
                        sourcePresets.find(
                          (preset) => preset.provider === editing.provider,
                        )?.name ?? editing.name,
                      )}
                    </p>
                  </div>
                </div>
                <label>
                  {t("name")}
                  <input
                    required
                    value={editing.name}
                    onChange={(event) =>
                      setEditing({ ...editing, name: event.target.value })
                    }
                  />
                </label>
                {editing.credential === "api-key" && !editing.hosted && (
                  <>
                    <label>
                      {t("apiUrl")}
                      <input
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
                    <label>
                      {t("protocol")}
                      <select
                        value={editing.protocol}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            protocol: event.target
                              .value as ModelSource["protocol"],
                          })
                        }
                      >
                        <option value="responses">Responses API</option>
                        <option value="chat">Chat Completions</option>
                      </select>
                    </label>
                    <label>
                      {t("apiKey")}
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={key}
                        onChange={(event) => setKey(event.target.value)}
                        placeholder={
                          editing.apiKeyPresent
                            ? t("apiKeyKeep")
                            : t("apiKeyEnter")
                        }
                      />
                    </label>
                  </>
                )}
                <label>
                  {t("modelName")}
                  <input
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
                <div className="agent-form-actions">
                  <button
                    className="settings-button"
                    type="submit"
                    disabled={busy}
                  >
                    {t("saveSource")}
                  </button>
                  <button
                    className="settings-button"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(null);
                      setKey("");
                    }}
                  >
                    {tc("cancel")}
                  </button>
                  {status.settings.sources.some(
                    (source) => source.id === editing.id,
                  ) && (
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
                        setNotice(t("toast.modelsLoaded"));
                      })}
                    >
                      {t("fetchModels")}
                    </button>
                  )}
                </div>
                {editing.credential === "chatgpt" && (
                  <p className="settings-help">{t("chatgptHelp")}</p>
                )}
              </form>
            )}
            {selected && (
              <div className="agent-form-actions">
                {selected.credential === "chatgpt" && !selected.hosted && (
                  <>
                    <button
                      className="settings-button"
                      disabled={
                        busy || status.authorization.state === "pending"
                      }
                      onClick={action(async () => {
                        const result = await desktop.invoke<{ url?: string }>(
                          "agent:authorize",
                          { id: selected.id },
                        );
                        if (result.url)
                          window.open(
                            result.url,
                            "_blank",
                            "noopener,noreferrer",
                          );
                        await refresh();
                      })}
                    >
                      {selected.connected
                        ? t("reauthorizeChatgpt")
                        : t("continueWithChatgpt")}
                    </button>
                    {selected.connected && (
                      <button
                        className="settings-button"
                        disabled={busy || hasRunning}
                        onClick={action(async () => {
                          update(
                            await desktop.invoke("agent:disconnect", {
                              id: selected.id,
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
                  className="settings-button"
                  disabled={
                    busy ||
                    hasRunning ||
                    status.runtime.state !== "ready" ||
                    !apiReady
                  }
                  onClick={action(() => test())}
                >
                  {t("testModel")}
                </button>
                <button
                  className="settings-button agent-remove"
                  disabled={busy || hasRunning}
                  onClick={action(async () => {
                    update(
                      await desktop.invoke("agent:removeSource", {
                        id: selected.id,
                      }),
                    );
                    setEditing(null);
                  })}
                >
                  <Trash2 size={12} />
                  {t("removeSource")}
                </button>
              </div>
            )}
            {status.authorization.state === "pending" && (
              <p className="settings-help" role="status">
                {t("authPending")}{" "}
                <button
                  onClick={action(async () =>
                    update(await desktop.invoke("agent:cancelAuth")),
                  )}
                >
                  {t("cancelAuth")}
                </button>
              </p>
            )}
            {status.authorization.error && (
              <p className="agent-error" role="alert">
                {status.authorization.error}
              </p>
            )}
          </section>
          <section
            className="settings-group"
            aria-labelledby="agent-runtime-title"
          >
            <h2 id="agent-runtime-title">{t("runtime")}</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <h3>
                  {t("runtimeName")}{" "}
                  {status.runtime.version && (
                    <span className="agent-version">
                      {status.runtime.version}
                    </span>
                  )}
                </h3>
                <p>{status.runtime.progress}</p>
              </div>
              <button
                className="settings-button"
                disabled={
                  busy || status.runtime.state === "installing" || hasRunning
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
                    : t("runtime.install")}
              </button>
            </div>
            <p className="settings-help">{t("runtimeHelp")}</p>
            {status.runtime.error && (
              <p className="agent-error" role="alert">
                {status.runtime.error}
              </p>
            )}
          </section>
        </>
      )}
      <section className="settings-group" aria-labelledby="agent-task-title">
        <h2 id="agent-task-title">{t("runInShowAI")}</h2>
        <p className="settings-help">{t("inPageHelp")}</p>
        {taskId && activeTask && (
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
        )}
      </section>
      <details className="agent-storage">
        <summary>{t("storage")}</summary>
        <p>
          {t("taskWorkspace")}
          <code>{status.workspaceRoot}</code>
        </p>
        <p>
          {t("credentialRoot")}
          <code>{status.credentialRoot}</code>
        </p>
        <p>{t("storageHelp")}</p>
      </details>
      {error && (
        <p className="agent-error agent-feedback" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="agent-feedback" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

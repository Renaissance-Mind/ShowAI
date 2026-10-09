import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
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
import type { PageSummary, ProjectSummary } from "../core/model";
import AgentBrandIcon from "./AgentBrandIcon";
import ServerResources from "./ServerResources";
import "./agent-settings.css";

function messageLinks(
  text: string,
  download: (path: string) => void,
): ReactNode[] {
  const output: ReactNode[] = [];
  let position = 0;
  for (const match of text.matchAll(
    /\[([^\]\n]+)\]\((?:<([^>]+)>|([^\)\n]+))\)/g,
  )) {
    output.push(text.slice(position, match.index));
    const href = match[2] ?? match[3];
    if (/^https?:\/\//i.test(href))
      output.push(
        <a key={match.index} href={href} target="_blank" rel="noreferrer">
          {match[1]}
        </a>,
      );
    else if (
      href.startsWith("/") ||
      href.startsWith("./") ||
      /^[A-Za-z]:[\\/]/.test(href)
    )
      output.push(
        <button
          key={match.index}
          className="agent-file-link"
          onClick={() => download(href)}
        >
          {match[1]}
        </button>,
      );
    else output.push(match[0]);
    position = match.index! + match[0].length;
  }
  output.push(text.slice(position));
  return output;
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
  const messages = task.events.filter((event) => event.type === "message");
  const tools = task.events.filter((event) => event.type === "tool");
  return (
    <article className="agent-task" aria-label={task.label}>
      <header>
        <span className={`agent-state state-${task.state}`}>
          {
            {
              running: "执行中",
              completed: "已完成",
              failed: "失败",
              cancelled: "已停止",
            }[task.state]
          }
        </span>
        <span>{task.label}</span>
        {task.state === "running" && (
          <button className="settings-button" onClick={onCancel}>
            <Square size={12} />
            停止
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
              取消此操作
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
          <summary>执行记录 · {tools.length}</summary>
          <pre>{tools.map((event) => event.text).join("\n\n")}</pre>
        </details>
      )}
      {task.state === "running" && (
        <p className="settings-help" role="status">
          <Loader2 size={13} className="studio-spin" />{" "}
          {task.events.filter((event) => event.type === "status").at(-1)
            ?.text ?? "正在执行…"}
        </p>
      )}
    </article>
  );
}

export default function AgentSettings({
  contextProjectId,
}: {
  contextProjectId?: string;
}) {
  const [status, setStatus] = useState<AgentHostStatus | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<ModelSource | null>(null),
    [key, setKey] = useState("");
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]),
    [pages, setPages] = useState<PageSummary[]>([]);
  const [projectId, setProjectId] = useState(contextProjectId ?? ""),
    [pageId, setPageId] = useState(""),
    [prompt, setPrompt] = useState("");
  const [taskId, setTaskId] = useState(""),
    [continueTask, setContinueTask] = useState(false);
  const mounted = useRef(true),
    settingsRef = useRef<Configuration | null>(null);
  const taskRef = useRef("");
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
    setStatus(next);
  }, []);
  const refresh = useCallback(
    async () =>
      update(
        await desktop.invoke<AgentHostStatus>("agent:status", {
          taskId: taskRef.current || undefined,
        }),
      ),
    [update],
  );
  useEffect(() => {
    mounted.current = true;
    void desktop
      .invoke<AgentHostStatus>("agent:scan")
      .then(update)
      .catch((error) => setError(errorMessage(error)));
    void desktop
      .invoke<ProjectSummary[]>("projects:list")
      .then(setProjects)
      .catch((error) => setError(errorMessage(error)));
    const timer = setInterval(
      () => void refresh().catch((error) => setError(errorMessage(error))),
      1200,
    );
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh, update]);
  useEffect(() => {
    setPageId("");
    setPages([]);
    if (projectId)
      void desktop
        .invoke<PageSummary[]>("pages:list", { projectId })
        .then(setPages)
        .catch((error) => setError(errorMessage(error)));
  }, [projectId]);
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
    setEditing({ id: crypto.randomUUID(), ...preset, model: "" });
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
    setNotice("模型来源已保存");
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
  if (!status)
    return (
      <div className="agent-settings">
        <p role="status">正在读取 Agent 设置…</p>
        {error && (
          <p role="alert" className="agent-error">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <div className="agent-settings">
      <section className="settings-group" aria-labelledby="agent-mode-title">
        <h2 id="agent-mode-title">执行方式</h2>
        <div
          className="agent-modes"
          role="radiogroup"
          aria-label="Agent 执行方式"
        >
          {(
            [
              {
                id: "local",
                title: "本机 Agent",
                text: "使用已安装 Agent 的登录与模型",
              },
              {
                id: "api",
                title: "提供 LLM API",
                text: "连接模型来源，由独立 Codex SDK 执行",
              },
            ] as const
          ).map((mode) => (
            <button
              key={mode.id}
              role="radio"
              aria-checked={status.settings.mode === mode.id}
              disabled={busy}
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
                {mode.title}
                {status.settings.mode === mode.id && <Check size={15} />}
              </span>
              <small>{mode.text}</small>
            </button>
          ))}
        </div>
      </section>
      {status.settings.mode === "local" ? (
        <section className="settings-group" aria-labelledby="local-agent-title">
          <h2 id="local-agent-title">可用 Agent</h2>
          <div className="settings-row">
            <p className="settings-help">
              复用本机登录。连接测试会发送一条简短请求，确认模型能够返回结果。
            </p>
            <button
              className="settings-button"
              disabled={busy}
              onClick={action(async () =>
                update(await desktop.invoke<AgentHostStatus>("agent:scan")),
              )}
            >
              <RefreshCw size={13} />
              重新探测
            </button>
          </div>
          <div className="agent-list" role="group" aria-label="选择本机 Agent">
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
                    <small>{agent.version || "未安装"}</small>
                  </span>
                  {status.settings.localAgent === agent.id && (
                    <span className="agent-current">当前</span>
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
                      ? "调用通过"
                      : agent.callable === false
                        ? "调用失败"
                        : agent.auth === "ready"
                          ? "已有登录／来源"
                          : agent.path
                            ? "待测试"
                            : "未找到"}
                  </span>
                  <button
                    className="settings-button"
                    aria-label={`测试 ${agent.name}`}
                    disabled={!agent.path || busy || hasRunning}
                    onClick={action(() => test(agent.id))}
                  >
                    测试连接
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
            <h2 id="agent-sources-title">模型来源</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <h3>当前来源</h3>
              </div>
              <div className="settings-select">
                <select
                  aria-label="当前模型来源"
                  value={status.settings.sourceId}
                  disabled={busy}
                  onChange={(event) =>
                    void action(() =>
                      change({ sourceId: event.target.value }),
                    )()
                  }
                >
                  <option value="">选择来源</option>
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
                    {selected.model || "尚未选择模型"}
                    {selected.account ? ` · ${selected.account}` : ""}
                  </small>
                  <small>
                    {selected.hosted ? `${selected.hosted.serverName} · ` : ""}
                    {selected.credential === "chatgpt"
                      ? selected.planEnabled
                        ? "已授权使用 ChatGPT 套餐"
                        : "等待 ChatGPT 套餐授权"
                      : selected.apiKeyPresent
                        ? "API Key 已保存"
                        : "等待 API Key"}
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
                  管理来源
                </button>
              </div>
            )}
            <div className="agent-presets" aria-label="添加模型来源">
              {sourcePresets.map((preset) => (
                <button
                  className="agent-preset"
                  key={preset.provider}
                  disabled={busy}
                  onClick={() => add(preset.provider)}
                >
                  <AgentBrandIcon brand={preset.provider} />
                  <span>
                    <strong>{preset.name}</strong>
                    <small>
                      {preset.credential === "chatgpt"
                        ? "账号授权"
                        : preset.provider === "custom"
                          ? "连接自己的模型服务"
                          : "使用 API Key 连接"}
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
                        ? "管理来源"
                        : "添加来源"}
                    </h3>
                    <p>
                      {sourcePresets.find(
                        (preset) => preset.provider === editing.provider,
                      )?.name ?? editing.name}
                    </p>
                  </div>
                </div>
                <label>
                  名称
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
                      API 地址
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
                      接口类型
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
                      API Key
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={key}
                        onChange={(event) => setKey(event.target.value)}
                        placeholder={
                          editing.apiKeyPresent
                            ? "已保存，留空保留现有 Key"
                            : "输入此来源的 API Key"
                        }
                      />
                    </label>
                  </>
                )}
                <label>
                  模型名称
                  <input
                    list="agent-model-options"
                    value={editing.model}
                    onChange={(event) =>
                      setEditing({ ...editing, model: event.target.value })
                    }
                    placeholder="从列表选择，或填写服务提供的模型 ID"
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
                    保存来源
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
                    取消
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
                        setNotice("模型列表已更新，可以选择模型");
                      })}
                    >
                      获取模型列表
                    </button>
                  )}
                </div>
                {editing.credential === "chatgpt" && (
                  <p className="settings-help">
                    先保存来源，再连接
                    ChatGPT。使用套餐额度需在授权页允许；可用模型以账号返回的列表为准。
                  </p>
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
                        ? "重新授权 ChatGPT"
                        : "Continue with ChatGPT"}
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
                        断开连接
                      </button>
                    )}
                    <a
                      className="settings-button"
                      href="https://chatgpt.com/settings/usage"
                      target="_blank"
                      rel="noreferrer"
                    >
                      管理套餐用量
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
                  测试模型调用
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
                  移除来源
                </button>
              </div>
            )}
            {status.authorization.state === "pending" && (
              <p className="settings-help" role="status">
                正在等待浏览器授权…{" "}
                <button
                  onClick={action(async () =>
                    update(await desktop.invoke("agent:cancelAuth")),
                  )}
                >
                  取消授权
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
            <h2 id="agent-runtime-title">内置执行能力</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <h3>
                  独立 Codex SDK{" "}
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
                  ? "检查并安装新版"
                  : status.runtime.state === "installing"
                    ? "正在安装"
                    : "一键安装 Codex SDK"}
              </button>
            </div>
            <p className="settings-help">
              按需下载官方 SDK 与运行时，使用独立账号、会话和 ShowAI 插件。
            </p>
            {status.runtime.error && (
              <p className="agent-error" role="alert">
                {status.runtime.error}
              </p>
            )}
          </section>
        </>
      )}
      <section className="settings-group" aria-labelledby="agent-task-title">
        <h2 id="agent-task-title">在 ShowAI 中执行任务</h2>
        <form
          className="agent-task-form"
          onSubmit={(event) => {
            event.preventDefault();
            void action(async () => {
              const task = await desktop.invoke<AgentTask>("agent:start", {
                projectId,
                ...(pageId ? { pageId } : {}),
                prompt,
                ...(continueTask && activeTask
                  ? { taskId: activeTask.id }
                  : {}),
              });
              setTaskId(task.id);
              setPrompt("");
              await refresh();
            })();
          }}
        >
          <div className="agent-target">
            <label>
              项目
              <select
                required
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">选择要操作的项目</option>
                {projects
                  .filter((project) => !project.archived)
                  .map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              页面
              <select
                value={pageId}
                disabled={!projectId}
                onChange={(event) => setPageId(event.target.value)}
              >
                <option value="">整个项目</option>
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label htmlFor="agent-prompt">任务要求</label>
          <textarea
            id="agent-prompt"
            required
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：阅读这个页面，将内容整理为可交互的研究概览，保留原有引用。"
            rows={4}
          />
          <div className="agent-form-actions">
            <button
              className="settings-button agent-run"
              type="submit"
              disabled={
                busy ||
                hasRunning ||
                !projectId ||
                !prompt.trim() ||
                (status.settings.mode === "api" &&
                  (status.runtime.state !== "ready" || !apiReady))
              }
            >
              <Bot size={14} />
              执行任务
            </button>
            {activeTask?.threadId &&
              status.settings.mode === "api" &&
              activeTask.projectId === projectId && (
                <label className="agent-continue">
                  <input
                    type="checkbox"
                    checked={continueTask}
                    onChange={(event) => setContinueTask(event.target.checked)}
                  />
                  继续所选会话
                </label>
              )}
          </div>
        </form>
        {status.tasks.length > 0 && (
          <>
            <div className="agent-task-picker">
              <select
                aria-label="任务记录"
                value={activeTask?.id ?? ""}
                onChange={(event) => setTaskId(event.target.value)}
              >
                {status.tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {new Date(task.startedAt).toLocaleTimeString("zh-CN")} ·{" "}
                    {task.label}
                  </option>
                ))}
              </select>
            </div>
            {activeTask && (
              <TaskResult
                task={activeTask}
                onFile={(path) =>
                  void action(async () => {
                    const file = await desktop.invoke<{
                      name: string;
                      mime: string;
                      base64: string;
                    }>("agent:readFile", { id: activeTask.id, path });
                    const bytes = Uint8Array.from(
                      atob(file.base64),
                      (character) => character.charCodeAt(0),
                    );
                    const url = URL.createObjectURL(
                      new Blob([bytes], { type: file.mime }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = file.name;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 30000);
                  })()
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
            {activeTask?.projectId && activeTask.state === "completed" && (
              <button
                className="settings-button"
                onClick={action(async () => {
                  await desktop.openWindow(
                    {
                      projectId: activeTask.projectId,
                      ...(activeTask.pageId
                        ? { pageId: activeTask.pageId }
                        : {}),
                    },
                    async () => true,
                  );
                })}
              >
                打开任务项目
              </button>
            )}
          </>
        )}
      </section>
      <details className="agent-storage">
        <summary>存储与运行位置</summary>
        <p>
          任务工作区：<code>{status.workspaceRoot}</code>
        </p>
        <p>
          账号与运行时：<code>{status.credentialRoot}</code>
        </p>
        <p>
          页面通过 ShowAI 工具保存到选定项目，工作区用于任务材料和中间文件。
        </p>
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

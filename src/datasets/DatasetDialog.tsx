import { useEffect, useMemo, useState } from "react";
import Dialog from "../studio/Dialog";
import { errorMessage } from "../studio/bridge";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/datasets";
import { ExternalLink } from "../ui/icons";
import {
  compileBinding,
  componentProps,
  defaultLocalKeys,
  readBinding,
  resolveBinding,
  shareBlock,
  snapshotBinding,
  suggestCollections,
  withComponentProps,
  type DatasetBinding,
} from "./binding.mjs";
import { isPlainObject } from "./operations.mjs";
import { useAvailableComponents } from "../components/custom/CustomBlock";
import type { DatasetScopeValue } from "./react";
import type { DatasetSnapshot } from "./client";

export interface DatasetDialogRequest {
  kind: string;
  data: Record<string, unknown>;
  /** Stores new block data through the editor, as one undoable change. */
  apply: (data: Record<string, unknown>) => void;
}
interface Summary {
  id: string;
  name: string;
  updatedAt: string;
  hash: string;
  bytes: number;
  source?: {
    format: string;
    name?: string;
    path?: string;
    available: boolean;
  };
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Asks the host for a data file; null when the person cancels. */
async function chooseDataFile(
  scope: DatasetScopeValue,
  projectId: string,
  mode: "open" | "save",
  name?: string,
): Promise<string | null> {
  const result = await scope.client.transport.invoke<{ path: string } | null>(
    "datasets:chooseFile",
    { projectId, mode, ...(name ? { name } : {}) },
  );
  return result?.path ?? null;
}

/** Where a bound dataset keeps its value, and moving it to or from a file. */
function SourceSection({
  scope,
  projectId,
  datasetId,
  snapshot,
}: {
  scope: DatasetScopeValue;
  projectId: string;
  datasetId: string;
  snapshot: DatasetSnapshot | undefined;
}) {
  const t = useTranslator(messages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const session = scope.client.session(projectId, datasetId);
  const source = snapshot?.source;
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      // Unsaved edits are written first, so the file receives them.
      if (snapshot?.status === "ready" && !(await session.flush()))
        throw new Error(t("sourceUnsaved"));
      await action();
      await session.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const link = (mode: "open" | "save") =>
    run(async () => {
      const path = await chooseDataFile(scope, projectId, mode, snapshot?.name);
      if (!path) return;
      await scope.client.transport.invoke("datasets:link", {
        projectId,
        datasetId,
        path,
        ...(mode === "save" ? { use: "dataset" } : {}),
        // Choosing a file for library data replaces it with the file's content.
        ...(mode === "open" && !source ? { use: "file" } : {}),
      });
    });
  const embed = () =>
    run(async () => {
      if (
        !window.confirm(
          t("embedConfirm", {
            name: snapshot?.name ?? datasetId,
            path: source?.path ?? source?.name ?? "",
          }),
        )
      )
        return;
      await scope.client.transport.invoke("datasets:embed", {
        projectId,
        datasetId,
        ...(snapshot?.hash ? { baseHash: snapshot.hash } : {}),
      });
    });
  const locked = busy || scope.readOnly;
  return (
    <section>
      <h3>{t("sourceTitle")}</h3>
      {!source ? (
        <>
          <p className="dataset-muted">{t("sourceLibrary")}</p>
          <p className="dataset-muted">{t("moveToFileHint")}</p>
          <button
            type="button"
            className="dataset-secondary"
            disabled={locked || snapshot?.status !== "ready"}
            onClick={() => void link("save")}
          >
            {t("moveToFile")}
          </button>
        </>
      ) : (
        <>
          {source.available && source.path ? (
            <>
              <p className="dataset-source-path">
                {t("sourceFile", { path: source.path })}
              </p>
              <p className="dataset-muted">
                {t("sourceFileMeta", {
                  format: source.format.toUpperCase(),
                  size: formatSize(source.bytes ?? 0),
                  time: source.modifiedAt
                    ? new Date(source.modifiedAt).toLocaleString()
                    : "",
                })}
              </p>
            </>
          ) : (
            <p className="dataset-message" role="alert">
              {source.path
                ? t("sourceUnreadable", {
                    name: snapshot?.name ?? datasetId,
                    path: source.path,
                  })
                : t("sourceUnlinked", {
                    name: snapshot?.name ?? datasetId,
                    file: source.name ?? "",
                  })}
            </p>
          )}
          <div className="dataset-row">
            <button
              type="button"
              disabled={locked}
              onClick={() => void link("open")}
            >
              {source.available ? t("relinkFile") : t("linkFileHere")}
            </button>
            <button
              type="button"
              disabled={locked || !source.available}
              onClick={() => void embed()}
            >
              {t("embedSource")}
            </button>
          </div>
          <p className="dataset-muted">{t("embedHint")}</p>
        </>
      )}
      {error && (
        <p className="dataset-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
interface Reference {
  projectId: string;
  pageId: string;
  title: string;
  blockIds: string[];
}

function useSnapshot(
  scope: DatasetScopeValue,
  projectId: string | undefined,
  datasetId: string | undefined,
) {
  const [snapshot, setSnapshot] = useState<DatasetSnapshot | undefined>();
  useEffect(() => {
    if (!projectId || !datasetId) {
      setSnapshot(undefined);
      return;
    }
    const session = scope.client.session(projectId, datasetId);
    const release = scope.client.retain(session);
    setSnapshot(session.getSnapshot());
    const unsubscribe = session.subscribe(() =>
      setSnapshot(session.getSnapshot()),
    );
    return () => {
      unsubscribe();
      release();
    };
  }, [scope.client, projectId, datasetId]);
  return snapshot;
}

/** Binding with the block's settings that stay local; shared keys are dropped from the block. */
function bound(
  kind: string,
  data: Record<string, unknown>,
  binding: DatasetBinding,
) {
  const compiled = compileBinding(binding);
  const props = componentProps(kind, data);
  const kept = compiled.props
    ? Object.fromEntries(
        Object.entries(props).filter(([key]) => compiled.props!.local.has(key)),
      )
    : props;
  return withComponentProps(kind, data, kept, binding);
}

function References({
  scope,
  projectId,
  datasetId,
  onOpen,
}: {
  scope: DatasetScopeValue;
  projectId: string;
  datasetId: string;
  onOpen: () => void;
}) {
  const t = useTranslator(messages);
  const [references, setReferences] = useState<Reference[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    scope.client.transport
      .invoke<Reference[]>("datasets:references", { projectId, datasetId })
      .then(setReferences, (caught) => setError(errorMessage(caught)));
  }, [scope.client, projectId, datasetId]);
  if (error)
    return (
      <p className="dataset-message" role="alert">
        {error}
      </p>
    );
  if (!references)
    return <p className="dataset-muted">{t("referencesLoading")}</p>;
  if (!references.length)
    return <p className="dataset-muted">{t("noReferences")}</p>;
  return (
    <ul className="dataset-references">
      {references.map((reference) => (
        <li key={`${reference.projectId}/${reference.pageId}`}>
          <span>{reference.title || reference.pageId}</span>
          <span className="dataset-muted">
            {t("blocks", { count: reference.blockIds.length })}
          </span>
          {reference.pageId !== scope.pageId && (
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("showai:open-page", {
                    detail: {
                      projectId: reference.projectId,
                      pageId: reference.pageId,
                      blockId: reference.blockIds[0],
                    },
                  }),
                );
                onOpen();
              }}
            >
              <ExternalLink size={13} aria-hidden="true" />
              {t("open")}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function BindingEditor({
  kind,
  data,
  value,
  text,
  onText,
}: {
  kind: string;
  data: Record<string, unknown>;
  value: unknown;
  text: string;
  onText: (text: string) => void;
}) {
  const t = useTranslator(messages);
  const preview = useMemo(() => {
    let binding: unknown;
    try {
      binding = JSON.parse(text);
    } catch (error) {
      return { error: t("invalidJson", { error: errorMessage(error) }) };
    }
    try {
      const next = bound(kind, data, binding as DatasetBinding);
      if (value === undefined) return { count: 0, issues: [] };
      const resolved = resolveBinding(kind, next, value);
      return { count: resolved.projected.size, issues: resolved.issues };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [kind, data, value, text, t]);
  return (
    <div className="dataset-editor">
      <label>
        {t("bindingJson")}
        <textarea
          value={text}
          spellCheck={false}
          rows={Math.min(24, Math.max(8, text.split("\n").length))}
          onChange={(event) => onText(event.target.value)}
        />
      </label>
      {"error" in preview ? (
        <p className="dataset-message" role="alert">
          {preview.error}
        </p>
      ) : (
        <>
          {preview.count > 0 && (
            <p className="dataset-muted">
              {t("preview", { count: preview.count })}
            </p>
          )}
          {preview.issues.length > 0 && (
            <ul className="dataset-issues" aria-label={t("issues")}>
              {preview.issues.map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function applyText(
  kind: string,
  data: Record<string, unknown>,
  text: string,
  overlay?: unknown,
) {
  const binding = JSON.parse(text) as DatasetBinding;
  if (isPlainObject(overlay) && binding.overlay === undefined)
    binding.overlay = overlay as DatasetBinding["overlay"];
  return bound(kind, data, binding);
}

function BoundSettings({
  request,
  scope,
  onClose,
}: {
  request: DatasetDialogRequest;
  scope: DatasetScopeValue;
  onClose: () => void;
}) {
  const t = useTranslator(messages);
  const binding = readBinding(request.data)!;
  const projectId = binding.project ?? scope.projectId;
  const snapshot = useSnapshot(scope, projectId, binding.dataset);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const { overlay, ...editable } = binding;
  const [text, setText] = useState(JSON.stringify(editable, null, 2));
  useEffect(() => {
    if (snapshot?.name) setName((current) => current || snapshot.name!);
  }, [snapshot?.name]);
  const session = scope.client.session(projectId, binding.dataset);
  return (
    <div className="dataset-dialog-body">
      <section>
        <h3>{t("current")}</h3>
        <div className="dataset-row">
          <label>
            {t("name")}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={scope.readOnly}
            />
          </label>
          <button
            type="button"
            disabled={!name.trim() || name === snapshot?.name || scope.readOnly}
            onClick={() =>
              session
                .rename(name.trim())
                .catch((caught) => setError(errorMessage(caught)))
            }
          >
            {t("rename")}
          </button>
        </div>
        <p className="dataset-muted">
          {t("datasetId", { id: binding.dataset })}
        </p>
      </section>
      <SourceSection
        scope={scope}
        projectId={projectId}
        datasetId={binding.dataset}
        snapshot={snapshot}
      />
      <section>
        <h3>{t("references")}</h3>
        <References
          scope={scope}
          projectId={projectId}
          datasetId={binding.dataset}
          onOpen={onClose}
        />
      </section>
      <section>
        <h3>{t("modeAdvanced")}</h3>
        <BindingEditor
          kind={request.kind}
          data={request.data}
          value={snapshot?.value}
          text={text}
          onText={setText}
        />
        <button
          type="button"
          className="dataset-primary"
          disabled={scope.readOnly}
          onClick={() => {
            try {
              request.apply(
                applyText(request.kind, request.data, text, overlay),
              );
              onClose();
            } catch (caught) {
              setError(errorMessage(caught));
            }
          }}
        >
          {t("apply")}
        </button>
      </section>
      <section>
        <h3>{t("detach")}</h3>
        <p className="dataset-muted">{t("detachHint")}</p>
        <button
          type="button"
          disabled={scope.readOnly || snapshot?.status !== "ready"}
          onClick={() => {
            request.apply(
              snapshotBinding(request.kind, request.data, snapshot!.value),
            );
            onClose();
          }}
        >
          {t("detach")}
        </button>
      </section>
      {error && (
        <p className="dataset-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function BindChoices({
  request,
  scope,
  onClose,
}: {
  request: DatasetDialogRequest;
  scope: DatasetScopeValue;
  onClose: () => void;
}) {
  const t = useTranslator(messages);
  const props = componentProps(request.kind, request.data);
  const keys = Object.keys(props);
  const component = useAvailableComponents().find(
    (item) => item.id === request.data.componentId,
  );
  const [name, setName] = useState(
    typeof props.title === "string" && props.title.trim()
      ? props.title.trim()
      : request.kind === "custom"
        ? (component?.name ?? String(request.data.componentId))
        : request.kind,
  );
  const [local, setLocal] = useState<string[]>(
    defaultLocalKeys(request.kind).filter((key) => keys.includes(key)),
  );
  const [datasets, setDatasets] = useState<Summary[] | null>(null);
  const [chosen, setChosen] = useState<string>();
  const [mode, setMode] = useState<"props" | "rows" | "advanced">("props");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const snapshot = useSnapshot(scope, scope.projectId, chosen);
  const load = () =>
    scope.client.transport
      .invoke<Summary[]>("datasets:list", { projectId: scope.projectId })
      .then(setDatasets, (caught) => setError(errorMessage(caught)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!chosen) return;
    const columns = Array.isArray(props.columns)
      ? (props.columns as { id: string; type: string }[])
      : [];
    if (mode === "rows" && snapshot?.value !== undefined)
      setText(
        JSON.stringify(
          {
            dataset: chosen,
            collections: suggestCollections(snapshot.value, columns).map(
              ({ count: _count, ...collection }) => collection,
            ),
          },
          null,
          2,
        ),
      );
    if (mode === "advanced")
      setText(JSON.stringify({ dataset: chosen, props: { local } }, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, mode, snapshot?.value !== undefined]);
  const toggle = (key: string) =>
    setLocal((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  const localKeys = (
    <fieldset className="dataset-keys">
      <legend>{t("localKeys")}</legend>
      <p className="dataset-muted">{t("localKeysHint")}</p>
      {keys.map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={local.includes(key)}
            onChange={() => toggle(key)}
          />
          {key}
        </label>
      ))}
    </fieldset>
  );
  const share = async () => {
    setBusy(true);
    setError("");
    try {
      const id = crypto.randomUUID();
      const shared = shareBlock(request.kind, request.data, id, local);
      await scope.client.transport.invoke("datasets:create", {
        projectId: scope.projectId,
        datasetId: id,
        name: name.trim(),
        value: shared.value,
        local,
        ...(scope.pageId ? { pageId: scope.pageId } : {}),
        ...(request.kind === "custom"
          ? {
              fromComponent: {
                componentId: request.data.componentId,
                version: request.data.version,
                ...(request.data.integrity
                  ? { integrity: request.data.integrity }
                  : {}),
                ...(request.data.scope ? { scope: request.data.scope } : {}),
              },
            }
          : { originKind: request.kind }),
      });
      request.apply(shared.data);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const bind = () => {
    setError("");
    try {
      const next =
        mode === "props"
          ? bound(request.kind, request.data, {
              dataset: chosen!,
              props: { local },
            })
          : applyText(request.kind, request.data, text);
      request.apply(next);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };
  const createFromFile = async () => {
    setBusy(true);
    setError("");
    try {
      const path = await chooseDataFile(scope, scope.projectId, "open");
      if (!path) return;
      const file = path.split(/[\\/]/).at(-1) ?? path;
      const record = await scope.client.transport.invoke<{
        dataset: { id: string };
      }>("datasets:link", {
        projectId: scope.projectId,
        name: file.replace(/\.[^.]+$/, "") || file,
        path,
      });
      await load();
      setChosen(record.dataset.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (summary: Summary) => {
    setError("");
    try {
      const references = await scope.client.transport.invoke<Reference[]>(
        "datasets:references",
        {
          projectId: scope.projectId,
          datasetId: summary.id,
        },
      );
      if (references.length) {
        setError(t("deleteBlocked"));
        return;
      }
      if (!window.confirm(t("deleteConfirm", { name: summary.name }))) return;
      await scope.client.transport.invoke("datasets:remove", {
        projectId: scope.projectId,
        datasetId: summary.id,
        baseHash: summary.hash,
      });
      if (chosen === summary.id) setChosen(undefined);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };
  return (
    <div className="dataset-dialog-body">
      <section>
        <h3>{t("shareTitle")}</h3>
        <p className="dataset-muted">{t("shareDescription")}</p>
        <label>
          {t("name")}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {keys.length > 0 && localKeys}
        <button
          type="button"
          className="dataset-primary"
          disabled={busy || !name.trim()}
          onClick={() => void share()}
        >
          {t("createAndBind")}
        </button>
      </section>
      <section>
        <h3>{t("useExisting")}</h3>
        {datasets && !datasets.length && (
          <p className="dataset-muted">{t("noDatasets")}</p>
        )}
        <p className="dataset-muted">{t("createFromFileHint")}</p>
        <button
          type="button"
          className="dataset-secondary"
          disabled={busy || scope.readOnly}
          onClick={() => void createFromFile()}
        >
          {t("createFromFile")}
        </button>
        {!!datasets?.length && (
          <ul className="dataset-choices" aria-label={t("chooseDataset")}>
            {datasets.map((summary) => (
              <li key={summary.id}>
                <label>
                  <input
                    type="radio"
                    name="dataset"
                    checked={chosen === summary.id}
                    onChange={() => setChosen(summary.id)}
                  />
                  <span>{summary.name}</span>
                  {summary.source && (
                    <span
                      className="dataset-muted"
                      title={summary.source.path ?? summary.source.name}
                    >
                      {summary.source.available
                        ? t("externalBadge", {
                            file: summary.source.name ?? summary.source.format,
                          })
                        : t("externalUnavailable")}
                    </span>
                  )}
                  <span className="dataset-muted">
                    {t("updated", {
                      time: new Date(summary.updatedAt).toLocaleString(),
                    })}
                  </span>
                </label>
                <button
                  type="button"
                  className="dataset-danger"
                  onClick={() => void remove(summary)}
                >
                  {t("deleteDataset")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {chosen && (
          <>
            <div className="dataset-modes" role="radiogroup">
              <label>
                <input
                  type="radio"
                  checked={mode === "props"}
                  onChange={() => setMode("props")}
                />
                {t("modeProps")}
              </label>
              {request.kind === "database" && (
                <label>
                  <input
                    type="radio"
                    checked={mode === "rows"}
                    onChange={() => setMode("rows")}
                  />
                  {t("modeRows")}
                </label>
              )}
              <label>
                <input
                  type="radio"
                  checked={mode === "advanced"}
                  onChange={() => setMode("advanced")}
                />
                {t("modeAdvanced")}
              </label>
            </div>
            {mode === "props" ? (
              keys.length > 0 && localKeys
            ) : (
              <BindingEditor
                kind={request.kind}
                data={request.data}
                value={snapshot?.value}
                text={text}
                onText={setText}
              />
            )}
            <button type="button" className="dataset-primary" onClick={bind}>
              {t("bind")}
            </button>
          </>
        )}
      </section>
      {error && (
        <p className="dataset-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function DatasetDialog({
  request,
  scope,
  onClose,
}: {
  request: DatasetDialogRequest;
  scope: DatasetScopeValue;
  onClose: () => void;
}) {
  const t = useTranslator(messages);
  return (
    <Dialog
      title={t("dialogTitle")}
      onClose={onClose}
      wide
      className="dataset-dialog"
    >
      {readBinding(request.data) ? (
        <BoundSettings request={request} scope={scope} onClose={onClose} />
      ) : (
        <BindChoices request={request} scope={scope} onClose={onClose} />
      )}
    </Dialog>
  );
}

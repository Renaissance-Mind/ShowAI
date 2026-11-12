// The workbench's database host: related datasets through the window's
// dataset sessions, reverse relations, formulas in the transform runtime and
// field types that library components contribute (contributes.databaseField),
// whose `field` export runs in the same iframe sandbox as custom components.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DatabaseHostContext,
  type ContributedField,
  type DatabaseHost,
  type DatasetListing,
  type FieldComponentRef,
  type FieldDisplay,
  type FieldEditorProps,
  type FieldTypeListing,
} from "../components/blocks/database-host";
import { injectComponentBootstrap } from "../contract/contract";
import {
  componentSandboxPolicy,
  withoutPackagePolicies,
} from "../contract/sandbox-policy.mjs";
import type {
  CompiledComponent,
  ComponentListing,
} from "../contract/types";
import { appearanceTokens, installSandboxTheme } from "../design/sandbox-theme";
import { useAppearanceTheme } from "../design/useAppearanceTheme";
import { recordTable, type RecordTable } from "./derived-fields.mjs";
import {
  projectAs,
  type TypedField,
  type ValueKind,
  type ValueType,
} from "./value-types.mjs";
import type { DatasetClient, DatasetSession } from "./client";
import { desktop } from "../host/bridge";

const json = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
const refKey = (ref: FieldComponentRef) => `${ref.componentId}@${ref.version}`;

/** The sandboxed page of a field type component; `field` adds the editor protocol. */
function fieldFrame(
  component: CompiledComponent,
  channel: string,
  props: Record<string, unknown>,
  options: { readOnly: boolean; field?: unknown; theme: string },
) {
  return (
    `<!doctype html><meta http-equiv="Content-Security-Policy" content="${componentSandboxPolicy}">` +
    injectComponentBootstrap(
      withoutPackagePolicies(component.html),
      `<script>(${installSandboxTheme.toString()})(${json(channel)},${json(options.theme)},${json(appearanceTokens())});</script><script id="showai-component-data" type="application/json">${json({ channel, props, readOnly: options.readOnly, ...(options.field ? { field: options.field } : {}) })}</script>`,
    )
  );
}

/**
 * Runs a field type's synchronous `field.format` and `field.project` in a
 * hidden sandbox frame and caches the answers by value; misses answer
 * undefined now and notify when the sandbox replies.
 */
class FieldEvaluator {
  private frame: HTMLIFrameElement;
  private channel = crypto.randomUUID();
  private ready = false;
  private queue: { key: string; fn: string; args: unknown[] }[] = [];
  private pending = new Set<string>();
  private results = new Map<
    string,
    { value?: unknown; error?: string; missing?: boolean }
  >();
  private timer = 0;
  private receive = (event: MessageEvent) => {
    if (
      event.source !== this.frame.contentWindow ||
      event.data?.channel !== this.channel
    )
      return;
    if (event.data.type === "showai:ready") {
      this.ready = true;
      this.flush();
    }
    if (event.data.type !== "showai:field-result") return;
    const keys: string[] = this.sent.get(event.data.requestId) ?? [];
    this.sent.delete(event.data.requestId);
    keys.forEach((key, index) => {
      this.pending.delete(key);
      this.results.set(key, event.data.results?.[index] ?? { missing: true });
    });
    this.changed();
  };
  private sent = new Map<string, string[]>();
  constructor(
    component: CompiledComponent,
    props: Record<string, unknown>,
    private changed: () => void,
  ) {
    this.frame = document.createElement("iframe");
    this.frame.setAttribute("sandbox", "allow-scripts");
    this.frame.setAttribute("aria-hidden", "true");
    this.frame.tabIndex = -1;
    this.frame.style.cssText =
      "position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0;pointer-events:none";
    this.frame.srcdoc = fieldFrame(component, this.channel, props, {
      readOnly: true,
      theme: document.documentElement.dataset.theme ?? "light",
    });
    window.addEventListener("message", this.receive);
    document.body.append(this.frame);
  }
  /** A cached answer, or undefined after asking the sandbox. */
  call(fn: string, args: unknown[]) {
    const key = `${fn}\u0000${JSON.stringify(args)}`;
    const result = this.results.get(key);
    if (result) return result;
    if (!this.pending.has(key)) {
      this.pending.add(key);
      this.queue.push({ key, fn, args });
      if (this.ready && !this.timer)
        this.timer = window.setTimeout(() => this.flush(), 0);
    }
    return undefined;
  }
  private flush() {
    this.timer = 0;
    if (!this.queue.length) return;
    const batch = this.queue.splice(0, 500);
    const requestId = crypto.randomUUID();
    this.sent.set(
      requestId,
      batch.map((item) => item.key),
    );
    this.frame.contentWindow?.postMessage(
      {
        channel: this.channel,
        type: "showai:field-call",
        requestId,
        calls: batch.map(({ fn, args }) => ({ fn, args })),
      },
      "*",
    );
    if (this.queue.length)
      this.timer = window.setTimeout(() => this.flush(), 0);
  }
  dispose() {
    window.removeEventListener("message", this.receive);
    clearTimeout(this.timer);
    this.frame.remove();
  }
}

/** The editor of a contributed field type: the component itself, in its sandbox. */
function FieldEditorFrame({
  component,
  column,
  value,
  onValue,
  onClose,
}: FieldEditorProps & { component: CompiledComponent }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const theme = useAppearanceTheme();
  const [channel] = useState(() => crypto.randomUUID());
  const [height, setHeight] = useState(120);
  const latest = useRef({ onValue, onClose, column, value });
  latest.current = { onValue, onClose, column, value };
  const html = useMemo(
    () =>
      fieldFrame(
        component,
        channel,
        (column as { config?: Record<string, unknown> }).config ??
          component.defaultData,
        {
          readOnly: !onValue,
          field: { value, column },
          theme,
        },
      ),
    // The frame keeps its page; later values arrive as messages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [component.html, channel],
  );
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { channel, type: "showai:field", field: { value, column } },
      "*",
    );
  }, [channel, value, column]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== channel
      )
        return;
      if (event.data.type === "showai:height")
        setHeight(Math.min(480, Math.max(40, Number(event.data.height) || 40)));
      if (event.data.type === "showai:field-value")
        latest.current.onValue?.(event.data.value);
      if (event.data.type === "showai:field-close") latest.current.onClose();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [channel]);
  return (
    <iframe
      ref={frame}
      className="sb-field-editor-frame"
      title={column.name ?? component.name}
      sandbox="allow-scripts"
      srcDoc={html}
      style={{ width: "100%", height, border: 0, display: "block" }}
    />
  );
}

const display = (
  result: { value?: unknown } | undefined,
): FieldDisplay | undefined => {
  if (!result) return undefined;
  const value = result.value;
  if (typeof value === "string") return { text: value };
  if (
    value &&
    typeof value === "object" &&
    typeof (value as FieldDisplay).text === "string"
  )
    return {
      text: (value as FieldDisplay).text,
      ...(typeof (value as FieldDisplay).tone === "string"
        ? { tone: (value as FieldDisplay).tone }
        : {}),
    };
  return { text: value === null || value === undefined ? "" : String(value) };
};
const rawText = (value: unknown) =>
  Array.isArray(value)
    ? value.map(String).join(", ")
    : value === null || value === undefined || typeof value === "object"
      ? ""
      : String(value);

/** A contributed field type from its compiled component. */
function contributedField(
  component: CompiledComponent,
  ref: FieldComponentRef,
  evaluator: (config: Record<string, unknown>) => FieldEvaluator,
): ContributedField {
  const field = component.contributes!.databaseField!;
  const kind = field.valueKind as ValueKind;
  const configOf = (column: TypedField) =>
    ((column as { config?: Record<string, unknown> }).config ??
      component.defaultData) as Record<string, unknown>;
  const answer = (fn: string, value: unknown, column: TypedField) => {
    const config = configOf(column);
    return evaluator(config).call(fn, [value ?? null, config]);
  };
  const valueType: ValueType = {
    type: "custom",
    kind,
    ...(field.operators ? { operators: field.operators } : {}),
    check: () => "",
    normalize: (value) => value,
    project: (value, column) => {
      const result = answer("project", value, column);
      return result && !result.missing && !result.error
        ? projectAs(kind, result.value)
        : projectAs(kind, value);
    },
    text: (value, column) =>
      display(answer("format", value, column))?.text ?? rawText(value),
    blank: () => (kind === "list" ? [] : kind === "boolean" ? false : ""),
    ...(kind === "option"
      ? {
          groups: (value: unknown) => [rawText(value)],
          regroup: (_value: unknown, _from: string, to: string) => to,
        }
      : {}),
    checkConfig: () => {},
  };
  return {
    ref,
    name: component.name,
    valueKind: kind,
    valueType,
    display: (value, column) => {
      const result = answer("format", value, column);
      return result?.missing || result?.error
        ? { text: rawText(value) }
        : display(result);
    },
    Editor: (props) => <FieldEditorFrame {...props} component={component} />,
  };
}

/** A page-level host; blocks add the dataset they show as selfDataset. */
function createHost(
  client: DatasetClient,
  projectId: string,
): DatabaseHost & { dispose(): void } {
  const listeners = new Set<() => void>();
  let version = 0;
  const bump = () => {
    version += 1;
    for (const listener of listeners) listener();
  };
  interface OpenDataset {
    session: DatasetSession;
    release: () => void;
    stop: () => void;
    table?: RecordTable;
    value?: unknown;
  }
  const sessions = new Map<string, OpenDataset>();
  const open = (datasetId: string) => {
    let entry = sessions.get(datasetId);
    if (!entry) {
      const session = client.session(projectId, datasetId);
      const created: OpenDataset = {
        session,
        release: client.retain(session),
        stop: () => {},
      };
      created.stop = session.subscribe(() => {
        const value = session.getSnapshot().value;
        if (value !== created.value) {
          created.value = value;
          created.table = recordTable(value) ?? undefined;
          bump();
        }
      }) as () => void;
      created.value = session.getSnapshot().value;
      created.table = recordTable(created.value) ?? undefined;
      sessions.set(datasetId, created);
      entry = created;
    }
    return entry;
  };
  let datasets: DatasetListing[] | undefined;
  let datasetsLoading = false;
  const loadDatasets = () => {
    if (datasetsLoading) return;
    datasetsLoading = true;
    void desktop
      .invoke<{ id: string; name: string }[]>("datasets:list", { projectId })
      .then((list) => {
        datasets = list.map(({ id, name }) => ({ id, name }));
        bump();
      })
      .finally(() => (datasetsLoading = false));
  };
  const incoming = new Map<
    string,
    {
      ids?: string[];
      names?: Map<string, string>;
      loading: boolean;
      result?: { datasetId: string; name?: string; value: unknown }[];
    }
  >();
  const loadIncoming = (datasetId: string) => {
    const entry = incoming.get(datasetId) ?? { loading: false };
    incoming.set(datasetId, entry);
    if (entry.loading) return;
    entry.loading = true;
    void desktop
      .invoke<{ datasetId: string; name: string }[]>("datasets:incoming", {
        projectId,
        datasetId,
      })
      .then((list) => {
        entry.ids = list.map((item) => item.datasetId);
        entry.names = new Map(list.map((item) => [item.datasetId, item.name]));
        entry.result = undefined;
        bump();
      })
      .finally(() => (entry.loading = false));
  };
  let fieldListings: FieldTypeListing[] | undefined;
  const compiled = new Map<string, CompiledComponent | null>();
  const evaluators = new Map<string, FieldEvaluator>();
  const fields = new Map<string, ContributedField>();
  const loadComponent = (ref: FieldComponentRef) => {
    const key = refKey(ref);
    if (compiled.has(key)) return;
    compiled.set(key, null);
    void desktop
      .invoke<CompiledComponent>("components:get", {
        id: ref.componentId,
        version: ref.version,
        projectId,
        ...(ref.scope ? { scope: ref.scope } : {}),
        ...(ref.integrity ? { integrity: ref.integrity } : {}),
      })
      .then((component) => {
        if (!component.contributes?.databaseField) return;
        compiled.set(key, component);
        bump();
      });
  };
  const loadFieldTypes = () => {
    fieldListings = [];
    void desktop
      .invoke<ComponentListing[]>("components:list", {
        projectId,
        scope: "all",
      })
      .then((items) => {
        const listed = items.filter(
          (item) => !!item.contributes?.databaseField,
        );
        for (const item of listed)
          loadComponent({
            componentId: item.id,
            version: item.version,
            integrity: item.integrity,
            scope: item.scope,
          });
        fieldListings = listed.map((item) => ({
          ref: {
            componentId: item.id,
            version: item.version,
            integrity: item.integrity,
            scope: item.scope,
          },
          name: item.name,
          valueKind: item.contributes!.databaseField!.valueKind,
          defaultConfig: {},
        }));
        bump();
      });
  };
  const stopChanges = desktop.onChange(() => {
    for (const id of incoming.keys()) loadIncoming(id);
    if (datasets) loadDatasets();
  });
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
    related: (datasetId) => open(datasetId).table,
    datasets: () => {
      if (!datasets) loadDatasets();
      return datasets;
    },
    incoming: (datasetId) => {
      const entry = incoming.get(datasetId);
      if (!entry) {
        loadIncoming(datasetId);
        return undefined;
      }
      if (!entry.ids) return undefined;
      const result = entry.ids.map((id) => ({
        datasetId: id,
        name: entry.names?.get(id),
        value: open(id).value,
      }));
      // The same array while nothing changed keeps memoized columns stable.
      if (
        entry.result?.length === result.length &&
        entry.result.every((item, index) => item.value === result[index].value)
      )
        return entry.result;
      entry.result = result;
      return result;
    },
    formulas: (inputs) =>
      desktop.invoke("datasets:formulas", { projectId, inputs }),
    fieldTypes: () => {
      if (!fieldListings) loadFieldTypes();
      return (fieldListings ?? []).map((listing) => {
        const component = compiled.get(refKey(listing.ref));
        return component
          ? { ...listing, defaultConfig: component.defaultData }
          : listing;
      });
    },
    field: (column) => {
      const ref = (column as { component?: FieldComponentRef }).component;
      if (column.type !== "custom" || !ref) return undefined;
      const key = refKey(ref);
      const component = compiled.get(key);
      if (component === undefined) loadComponent(ref);
      if (!component) return undefined;
      let field = fields.get(key);
      if (!field) {
        field = contributedField(component, ref, (config) => {
          const evaluatorKey = `${key}\u0000${JSON.stringify(config)}`;
          let evaluator = evaluators.get(evaluatorKey);
          if (!evaluator) {
            evaluator = new FieldEvaluator(component, config, bump);
            evaluators.set(evaluatorKey, evaluator);
          }
          return evaluator;
        });
        fields.set(key, field);
      }
      return field;
    },
    dispose() {
      stopChanges();
      for (const entry of sessions.values()) {
        entry.stop();
        entry.release();
      }
      for (const evaluator of evaluators.values()) evaluator.dispose();
      listeners.clear();
    },
  };
}

/** Provides the database host to the blocks of one project's pages. */
export function DatabaseHostProvider({
  client,
  projectId,
  children,
}: {
  client: DatasetClient | undefined;
  projectId: string | null | undefined;
  children: ReactNode;
}) {
  const host = useMemo(
    () => (client && projectId ? createHost(client, projectId) : null),
    [client, projectId],
  );
  useEffect(() => () => host?.dispose(), [host]);
  return (
    <DatabaseHostContext.Provider value={host}>
      {children}
    </DatabaseHostContext.Provider>
  );
}

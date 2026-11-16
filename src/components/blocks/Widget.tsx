import { cloneSourceValue, ownSourceValue } from "../../surface/source-runtime";
import { RichTextEnvironment } from "../rich-text/environment";
import { AssistantContext } from "../assistant-context";
import { CommentSlots } from "../comment-slots";
import { PageLinkContext } from "../page-links";
import {
  useComponentCatalog,
  RegisterComponentContext,
} from "../useComponentCatalog";
import {
  Component,
  useContext,
  useMemo,
  memo,
  useRef,
  useEffect,
  Suspense,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ComponentStatus, type ComponentStatusState } from "./ComponentStatus";
import {
  getBlockDefinition,
  getRegistryRevision,
  subscribeToBlocks,
} from "./registry";
import type { BlockProps } from "./types";
import "./block.css";
import { BoundWidgetHost, hasBinding } from "../../datasets/widget-host";
import { translator } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/widget";
import { PendingNotice } from "../../ui/PendingNotice";
import { useQueuedMount } from "./mount-queue";
import { ComponentRuntimeProvider } from "./component-runtime";
import { createComponentRuntime } from "../../contract/component-runtime.mjs";
import {
  componentHostRequest,
  contractPayloadIssue,
} from "../../contract/component-host";
import { useComponentEvents } from "./component-interactions";
import { BlockDataState } from "./action-host";
import {
  useReaderState,
  useReaderStateScope,
} from "../../surface/reader-state";
import {
  navigationTarget,
  requestNavigation,
} from "../../document/page-link.mjs";
import { dataNotice, unavailableText } from "./data-notice";

const widgetMessages = translator(messages);

function UnavailableBlock({
  kind,
  data,
  readOnly,
  state,
  error,
  stack,
  onRetry,
  unavailable,
}: BlockProps & {
  kind: string;
  state: ComponentStatusState;
  unavailable?: boolean;
  error?: string;
  stack?: string;
  onRetry?: () => void;
}) {
  const t = useTranslator(messages);
  const assistant = useContext(AssistantContext);
  const definition = getBlockDefinition(kind);
  return (
    <ComponentStatus
      state={state}
      name={definition?.title ?? kind}
      title={
        unavailable
          ? t("status.unavailable", { name: definition?.title ?? kind })
          : undefined
      }
      reference={kind}
      query={kind}
      error={error}
      stack={stack}
      cause={
        state === "missing"
          ? t("status.missingBuiltinCause", { kind })
          : state === "invalid"
            ? error
            : undefined
      }
      data={data}
      readOnly={readOnly}
      assistant={readOnly ? null : assistant}
      onRetry={onRetry}
    />
  );
}

class BlockBoundary extends Component<
  {
    children: ReactNode;
    kind: string;
    data: BlockProps["data"];
    readOnly?: boolean;
  },
  { error: { message: string; stack?: string } | null }
> {
  state = { error: null as { message: string; stack?: string } | null };
  static getDerivedStateFromError(error: Error) {
    return {
      error: {
        message: error?.message || widgetMessages("renderFailed"),
        ...(typeof error?.stack === "string" ? { stack: error.stack } : {}),
      },
    };
  }
  componentDidUpdate(previous: { data: BlockProps["data"]; kind: string }) {
    if (
      this.state.error &&
      (previous.data !== this.props.data || previous.kind !== this.props.kind)
    )
      this.setState({ error: null });
  }
  render() {
    return this.state.error ? (
      <UnavailableBlock
        kind={this.props.kind}
        data={this.props.data}
        readOnly={this.props.readOnly}
        state="crashed"
        error={this.state.error.message}
        stack={this.state.error.stack}
        onRetry={() => this.setState({ error: null })}
      />
    ) : (
      this.props.children
    );
  }
}

export const Widget = memo(function Widget(
  props: BlockProps & { kind: string },
) {
  const host = useContext(BoundWidgetHost);
  if (!hasBinding(props.data))
    return (
      <>
        {host && <host.Action {...props} />}
        <WidgetBody {...props} />
      </>
    );
  if (!host && dataNotice(props.data))
    return (
      <p className="sb-block sb-data-notice" role="status">
        {unavailableText(props.data)}
      </p>
    );
  return host ? (
    <>
      <host.Action {...props} />
      <host.Bound
        {...props}
        render={(resolved) => <WidgetBody {...resolved} />}
      />
    </>
  ) : (
    <UnavailableBlock
      kind={props.kind}
      data={props.data}
      readOnly={props.readOnly}
      state="invalid"
      unavailable
      error={widgetMessages("sharedDataUnavailable")}
    />
  );
});

const WidgetBody = memo(function WidgetBody({
  kind,
  data,
  onChange,
  readOnly,
  host,
  inline,
}: BlockProps & { kind: string }) {
  const draft = useMemo(
    () => (kind === "text" ? data : cloneSourceValue(data)),
    [data, kind],
  );
  const publish = onChange && !readOnly
    ? (value: typeof data) => onChange(ownSourceValue(value))
    : undefined;
  const registerComponent = useContext(RegisterComponentContext);
  const assistant = useContext(AssistantContext);
  const pageLinks = useContext(PageLinkContext);
  const comments = useContext(CommentSlots);
  const environment = useMemo(
    () => ({
      useCatalog: useComponentCatalog,
      registerComponent,
      validateWidget: (kind: string, data: Record<string, unknown>) => {
        const definition = getBlockDefinition(kind);
        if (!definition) throw new Error(`Unknown component kind: ${kind}`);
        definition.validate?.(data);
      },
      renderWidget: (props: BlockProps & { kind: string }) => (
        <Widget {...props} />
      ),
      assistant: readOnly ? null : assistant,
      pageLinks: readOnly ? null : pageLinks,
      comments: readOnly ? null : comments,
    }),
    [registerComponent, assistant, pageLinks, comments, readOnly],
  );
  useSyncExternalStore(
    subscribeToBlocks,
    getRegistryRevision,
    getRegistryRevision,
  );
  const t = useTranslator(messages);
  const queued = useQueuedMount();
  const definition = getBlockDefinition(kind);
  const events = useComponentEvents();
  const dataState = useContext(BlockDataState);
  const scope = useReaderStateScope();
  const contract = definition?.contract ?? { version: 1 as const };
  const [view, setView] = useReaderState<unknown>(
    `runtime:${kind}:view:${contract.view?.version ?? 0}`,
    undefined,
    {
      accept: (value) =>
        !contract.view ||
        !contractPayloadIssue(contract, "view", "state", value),
    },
  );
  const active = useRef({
    data: draft,
    readOnly,
    onChange: publish,
    events,
    view,
    setView,
    scope,
    dataState,
  });
  active.current = {
    data: draft,
    readOnly,
    onChange: publish,
    events,
    view,
    setView,
    scope,
    dataState,
  };
  const runtime = useMemo(
    () =>
      createComponentRuntime({
        contract,
        state: () => ({
          data: active.current.data,
          readOnly: !active.current.onChange,
          view: active.current.view,
          dataState: active.current.dataState,
        }),
        validate: (kind, name, value) =>
          contractPayloadIssue(contract, kind, name, value),
        capabilities: () => ({
          data: 1,
          events: 1,
          actions: 1,
          content: 1,
          references: 1,
          navigation: 1,
          view: active.current.scope?.block ? 1 : 0,
        }),
        request: (operation, input) =>
          componentHostRequest({
            contract,
            data: active.current.data,
            operation,
            input,
            gesture:
              !navigator.userActivation || navigator.userActivation.isActive,
            services: {
              "event.emit": (value) =>
                active.current.events.emit(
                  value.name,
                  value.target,
                  value.payload,
                ),
              "data.update": active.current.onChange
                ? (value) => {
                    definition?.validate?.(value);
                    active.current.onChange!(value);
                    return { status: "handled" };
                  }
                : undefined,
              "view.set": active.current.scope?.block
                ? (value) => {
                    active.current.setView(value);
                    return { status: "handled" };
                  }
                : undefined,
              "navigation.open": (value) => {
                const target = navigationTarget(value);
                if (!target) throw new Error("Invalid navigation target");
                const scope = active.current.scope;
                const id = scope?.block?.slice(
                  scope.namespace ? scope.namespace.length + 1 : 0,
                );
                const source = id
                  ? document.querySelector(
                      `[data-block-id="${CSS.escape(id)}"]`,
                    )
                  : document.body;
                return {
                  status: requestNavigation(source ?? document.body, target)
                    ? "handled"
                    : "unhandled",
                };
              },
            },
          }),
      }),
    [kind, definition],
  );
  useEffect(() => () => runtime.dispose(), [runtime]);
  const pending = (
    <PendingNotice
      ref={queued.placeholder}
      className="sb-block"
      data-preview-pending="true"
      label={t("loading")}
      lines={2}
      minHeight={
        queued.height ??
        (typeof data.height === "number"
          ? data.height
          : kind.startsWith("g2-")
            ? 320
            : 180)
      }
    />
  );
  if (!queued.mounted && !inline) return pending;
  if (!definition)
    return (
      <UnavailableBlock
        kind={kind}
        data={data}
        readOnly={readOnly}
        state="missing"
      />
    );
  if (definition.validate) {
    try {
      definition.validate(draft);
    } catch (error) {
      return (
        <UnavailableBlock
          kind={kind}
          data={data}
          readOnly={readOnly}
          state="invalid"
          error={error instanceof Error ? error.message : t("invalidData")}
        />
      );
    }
  }
  const Renderer = definition.renderer;
  return (
    <BlockBoundary key={kind} kind={kind} data={data} readOnly={readOnly}>
      <Suspense fallback={pending}>
        <RichTextEnvironment.Provider value={environment}>
          <ComponentRuntimeProvider
            runtime={runtime}
            renderWidget={environment.renderWidget}
          >
            <Renderer
              runtime={runtime}
              data={draft}
              onChange={publish}
              readOnly={readOnly}
              host={host}
              {...(inline ? { inline } : {})}
            />
          </ComponentRuntimeProvider>
        </RichTextEnvironment.Provider>
      </Suspense>
    </BlockBoundary>
  );
});

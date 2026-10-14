import { RichTextEnvironment } from "../rich-text/environment";
import {
  useComponentCatalog,
  RegisterComponentContext,
} from "../useComponentCatalog";
import {
  Component,
  useContext,
  useMemo,
  memo,
  Suspense,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { FileJson, Puzzle } from "../../ui/icons";
import {
  getBlockDefinition,
  getRegistryRevision,
  subscribeToBlocks,
} from "./registry";
import { downloadFile } from "./helpers";
import type { BlockProps } from "./types";
import "./block.css";
import { translator } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/widget";

const widgetMessages = translator(messages);

function UnavailableBlock({
  kind,
  data,
  error,
}: BlockProps & { kind: string; error?: string }) {
  const t = useTranslator(messages);
  return (
    <section className="sb-block sb-unavailable" aria-label={t("unavailable")}>
      <div className="sb-unavailable-heading">
        <Puzzle size={20} />
        <div>
          <strong>
            {error ? t("needsCheck") : t("notRegistered", { kind })}
          </strong>
          <p>{error || t("dataKept")}</p>
        </div>
      </div>
      <details className="sb-data-details">
        <summary>{t("viewData")}</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
      <button
        type="button"
        className="sb-button"
        onClick={() =>
          downloadFile(
            JSON.stringify({ kind, data }, null, 2),
            `${kind}.json`,
            "application/json",
          )
        }
      >
        <FileJson size={14} />
        {t("downloadData")}
      </button>
    </section>
  );
}

class BlockBoundary extends Component<
  { children: ReactNode; kind: string; data: BlockProps["data"] },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message || widgetMessages("renderFailed") };
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
        error={this.state.error}
      />
    ) : (
      this.props.children
    );
  }
}

export const Widget = memo(function Widget({
  kind,
  data,
  onChange,
  readOnly,
  host,
}: BlockProps & { kind: string }) {
  const registerComponent = useContext(RegisterComponentContext);
  const environment = useMemo(
    () => ({
      useCatalog: useComponentCatalog,
      registerComponent,
      renderWidget: (props: BlockProps & { kind: string }) => (
        <Widget {...props} />
      ),
    }),
    [registerComponent],
  );
  useSyncExternalStore(
    subscribeToBlocks,
    getRegistryRevision,
    getRegistryRevision,
  );
  const t = useTranslator(messages);
  const definition = getBlockDefinition(kind);
  if (!definition) return <UnavailableBlock kind={kind} data={data} />;
  if (definition.validate) {
    try {
      definition.validate(data);
    } catch (error) {
      return (
        <UnavailableBlock
          kind={kind}
          data={data}
          error={error instanceof Error ? error.message : t("invalidData")}
        />
      );
    }
  }
  const Renderer = definition.renderer;
  return (
    <BlockBoundary key={kind} kind={kind} data={data}>
      <Suspense
        fallback={
          <section
            className="sb-block"
            data-preview-pending="true"
            role="status"
            style={{
              minHeight:
                typeof data.height === "number"
                  ? data.height
                  : kind.startsWith("g2-")
                    ? 320
                    : 180,
            }}
          >
            {t("loading")}
          </section>
        }
      >
        <RichTextEnvironment.Provider value={environment}>
          <Renderer
            data={data}
            onChange={readOnly ? undefined : onChange}
            readOnly={readOnly}
            host={host}
          />
        </RichTextEnvironment.Provider>
      </Suspense>
    </BlockBoundary>
  );
});

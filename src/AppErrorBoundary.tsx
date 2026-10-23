import { Component, type ErrorInfo, type ReactNode } from "react";
import { translator } from "./i18n";
import messages from "./i18n/messages/appShell";
import { redact } from "./core/redact";
import { ReportProblemForm } from "./studio/feedback/ReportProblemForm";
import {
  dispatchReportProblem,
  type ReportProblemDetail,
} from "./studio/problems/report-event";

const t = translator(messages);

/** A lazily loaded interface file failed to arrive (update, restart, offline). */
export function isChunkLoadError(error: unknown): boolean {
  const text =
    error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading (?:CSS )?chunk \S+ failed/i.test(
    text,
  );
}

function meta(name: string) {
  return (
    document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ??
    "unknown"
  );
}

export function errorDetails(
  error: unknown,
  componentStack: string,
  at: string,
): string {
  const failure = error instanceof Error ? error : new Error(String(error));
  return [
    `ShowAI ${meta("showai-version")} (${meta("showai-source")})`,
    `Time: ${at}`,
    `Agent: ${navigator.userAgent}`,
    "",
    `${failure.name}: ${failure.message}`,
    failure.stack ?? "",
    componentStack ? `\nComponent stack:${componentStack}` : "",
  ]
    .join("\n")
    .trim();
}

async function copyText(text: string) {
  if (window.showai)
    await window.showai.invoke("clipboard:write", { text: text.slice(0, 1e6) });
  else await navigator.clipboard.writeText(text);
}

interface State {
  error: unknown;
  componentStack: string;
  at: string;
  copied: boolean;
  /** The workbench is gone, so the report form opens on this page. */
  report?: ReportProblemDetail;
}

/** Keeps an uncaught interface error from leaving a blank window. */
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = { error: null, componentStack: "", at: "", copied: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error("Unknown error"), at: new Date().toISOString() };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? "" });
    console.error("ShowAI interface error", error, info.componentStack);
  }

  render() {
    const { error, componentStack, at, copied } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkLoadError(error);
    const message = error instanceof Error ? error.message : String(error);
    const code = chunk
      ? "CHUNK_LOAD_FAILED"
      : error instanceof Error
        ? error.name
        : "RENDER_ERROR";
    const report = () => {
      const detail: ReportProblemDetail = {
        source: "app",
        code,
        message: redact(message, { truncateIds: true }),
        at,
      };
      // 关于与反馈 takes over when the workbench still runs; otherwise report here.
      if (dispatchReportProblem(detail)) this.setState({ report: detail });
    };
    return (
      <main
        role="alert"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "var(--paper, #f8f8f6)",
          color: "var(--ink, #222)",
        }}
      >
        <div style={{ maxWidth: 620, display: "grid", gap: 14 }}>
          <h1 style={{ fontSize: 20, margin: 0, fontWeight: 600 }}>
            {chunk ? t("crash.chunkTitle") : t("crash.title")}
          </h1>
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            {chunk ? t("crash.chunkDetail") : t("crash.detail")}
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              opacity: 0.7,
              overflowWrap: "anywhere",
            }}
          >
            {code}: {message}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="studio-button primary"
              onClick={() => location.reload()}
            >
              {t("crash.reload")}
            </button>
            <button
              className="studio-button"
              onClick={() =>
                void copyText(errorDetails(error, componentStack, at)).then(
                  () => this.setState({ copied: true }),
                  (reason) => console.error("Copy failed", reason),
                )
              }
            >
              {copied ? t("crash.copied") : t("crash.copy")}
            </button>
            <button className="studio-button" onClick={report}>
              {t("crash.report")}
            </button>
          </div>
          {this.state.report && (
            <div className="app-crash-report">
              <ReportProblemForm context={this.state.report} />
            </div>
          )}
        </div>
      </main>
    );
  }
}

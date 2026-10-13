import {
  StrictMode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PageIcon from "../components/PageIcon";
import { installIconTooltips } from "../ui/icon-tooltip.mjs";
import { createRoot } from "react-dom/client";
import { Download, Moon, MoreHorizontal, Printer, Sun } from "../ui/icons";
import { parseArtifact, serializeArtifact } from "./validation.mjs";
import type { ShowArtifact, ShowDocument } from "../types";
import { loadRemoteComponents } from "./remote.mjs";
import type { CompiledComponent } from "../components/custom/types";
import { SurfaceReader } from "./SurfaceReader";
import { CustomComponentsProvider } from "../components/custom/CustomBlock";
import { resolveLocale, setLocale, translator } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/reader";
import common from "../i18n/messages/common";
import "./portable.css";
import "../design/tokens.css";
import "../design/content.css";

// Set only by the trusted inline exporter. Ordinary readers and the desktop app
// keep individual sandboxed iframes for custom code.
// The exporter writes its language into <html lang>; older exports default to zh-CN.
setLocale(
  resolveLocale(window.document.documentElement.lang || navigator.language),
);
const translate = translator(messages);

const inlineHost =
  window.document
    .getElementById("root")
    ?.closest<HTMLElement>("[data-showai-inline-root]") ?? null;

/** Remote loader errors carry a code so the reader can explain them in its own language. */
function remoteErrorMessage(error: unknown): string {
  const { code, params } = (error ?? {}) as {
    code?: string;
    params?: { component?: string; reason?: string };
  };
  const component = params?.component ?? "";
  if (code === "INTEGRITY_UNAVAILABLE") return translate("integrityUnavailable");
  if (code === "COMPONENT_FETCH_FAILED")
    return translate("componentFetchFailed", {
      component,
      reason: params?.reason || translate("networkFailed"),
    });
  if (code === "COMPONENT_CHECKSUM_FAILED")
    return translate("componentChecksumFailed", { component });
  return error instanceof Error ? error.message : translate("remoteLoadFailed");
}

function downloadSource(
  document: ShowDocument,
  components: ShowArtifact["components"],
  remoteComponents: ShowArtifact["remoteComponents"],
  presentation: ShowArtifact["presentation"],
  selection: ShowArtifact["selection"],
) {
  const url = URL.createObjectURL(
    new Blob(
      [
        serializeArtifact(
          document,
          components,
          remoteComponents,
          presentation,
          selection,
        ),
      ],
      {
        type: "application/json",
      },
    ),
  );
  const link = window.document.createElement("a");
  link.href = url;
  link.download = `${document.title.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "page"}.showai.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ArtifactReader({ artifact }: { artifact: ShowArtifact }) {
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const { document } = artifact;
  const draftPreview = useMemo(() => {
    const options = window.document.getElementById(
      "showai-read-options",
    )?.textContent;
    return options ? JSON.parse(options).draft === true : false;
  }, []);
  const [dark, setDark] = useState(() => {
    const reading = window.document.getElementById(
      "showai-read-options",
    )?.textContent;
    return reading
      ? JSON.parse(reading).theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [remote, setRemote] = useState<CompiledComponent[]>([]);
  const [remoteError, setRemoteError] = useState("");
  const [remoteLoading, setRemoteLoading] = useState(
    !!artifact.remoteComponents?.length,
  );
  useEffect(() => {
    if (!artifact.remoteComponents?.length) return;
    if (inlineHost) {
      setRemoteError(t("remoteInlineBlocked"));
      setRemoteLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setRemoteLoading(true);
    void loadRemoteComponents(artifact.remoteComponents, {
      signal: controller.signal,
    })
      .then((components) => {
        if (active) {
          setRemote(components);
          setRemoteError("");
        }
      })
      .catch((error) => {
        if (active)
          setRemoteError(remoteErrorMessage(error));
      })
      .finally(() => {
        if (active) setRemoteLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [artifact.remoteComponents]);
  useEffect(() => {
    window.document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.document.addEventListener("pointerdown", closeOnPointer);
    window.document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.document.removeEventListener("pointerdown", closeOnPointer);
      window.document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <div
      className={`portable-app${artifact.selection ? " portable-partial" : ""}`}
    >
      {draftPreview && (
        <div className="portable-draft-note" role="status">
          {t("draftNote")}
        </div>
      )}
      <div className="portable-options" ref={menuRef}>
        <button
          ref={menuButtonRef}
          className="portable-options-trigger"
          aria-label={tc("pageOptions")}
          aria-expanded={menuOpen}
          aria-controls="page-options"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <MoreHorizontal size={19} />
        </button>
        {menuOpen && (
          <div className="portable-options-menu" id="page-options">
            <button
              onClick={() => {
                downloadSource(
                  document,
                  artifact.components,
                  artifact.remoteComponents,
                  artifact.presentation,
                  artifact.selection,
                );
                setMenuOpen(false);
              }}
            >
              <Download size={15} />{" "}
              {draftPreview
                ? t("downloadOriginalSource")
                : tc("downloadSource")}
            </button>
            <button
              onClick={() => {
                setDark(!dark);
                setMenuOpen(false);
              }}
            >
              {dark ? <Sun size={15} /> : <Moon size={15} />}
              {dark ? tc("lightAppearance") : tc("darkAppearance")}
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                window.print();
              }}
            >
              <Printer size={15} /> {tc("print")}
            </button>
          </div>
        )}
      </div>
      <CustomComponentsProvider
        components={[...(artifact.components ?? []), ...remote]}
        inlineHost={inlineHost}
      >
        <SurfaceReader
          document={document}
          presentation={artifact.presentation}
          partial={!!artifact.selection}
          heading={
            <>
              {!artifact.selection && (document.icon || document.title) && (
                <div className="portable-page-heading">
                  {document.icon && (
                    <div className="portable-page-icon">
                      <PageIcon value={document.icon} size={48} />
                    </div>
                  )}
                  {document.title && (
                    <h1 className="portable-title">{document.title}</h1>
                  )}
                </div>
              )}
              {!!artifact.remoteComponents?.length && (
                <p className="portable-network-note">
                  {remoteLoading
                    ? t("remoteLoading")
                    : t("remoteRequired")}
                </p>
              )}
              {remoteError && (
                <p role="alert" className="portable-network-error">
                  {remoteError}
                </p>
              )}
            </>
          }
        />
      </CustomComponentsProvider>
    </div>
  );
}

function App() {
  const t = useTranslator(messages);
  useLayoutEffect(() => installIconTooltips(window.document), []);
  const result = useMemo(() => {
    const raw = window.document.getElementById("showai-data")?.textContent;
    if (!raw || raw.trim() === "null") return { error: translate("emptyPage") };
    try {
      return { artifact: parseArtifact(raw) };
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : translate("unreadablePage"),
      };
    }
  }, []);
  if (!result.artifact)
    return (
      <main className="portable-error">
        <h1>{t("openFailed")}</h1>
        <p>{result.error}</p>
      </main>
    );
  return <ArtifactReader artifact={result.artifact} />;
}

createRoot(window.document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

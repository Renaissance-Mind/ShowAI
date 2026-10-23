import {OwnedSourceSession,createSourceTransport} from "./surface/source-client";
import {flushPortableInputs,portableInputsPending,stopPortableInputs} from "./surface/portable-input-scope";
import {flushHistoryTravels,historyTravelsPending,stopHistoryTravels} from "./surface/history-travel-queue";
import { CAPACITY, formatBytes } from "./portable/capacity.mjs";
import { linearContent } from "./surface/document.mjs";
import { upgradeResource } from "./surface/containers.mjs";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  FileJson,
  FileText,
  MoreHorizontal,
  Moon,
  Sun,
  Upload,
  X,
} from "./ui/icons";
import SurfaceEditor from "./surface/SurfaceEditor";
import { LibraryMenuControl } from "./studio/LibraryNavigation";
import {
  EditorHistoryButtons,
  containerMenuItems,
  type EditorControls,
} from "./surface/EditorControls";
import {
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "./lib/artifact";
import { CANVAS_KEY } from "./lib/canvas";
import {
  buildCanvasArtifactHtml,
  loadCanvasArtifact,
  materializeCanvasArtifact,
  retainCanvasArtifact,
  saveCanvasArtifact,
} from "./portable/canvas";
import { CustomComponentsProvider } from "./components/custom/CustomBlock";
import type { CompiledComponent } from "./components/custom/types";
import { downloadFile, newDocument, toMarkdown } from "./lib/document";
import { parseMarkdown } from "./lib/markdown";
import type { ShowArtifact, ShowDocument } from "./types";
import { translator } from "./i18n";
import { useTranslator } from "./i18n/react";
import messages from "./i18n/messages/canvas";
import common from "./i18n/messages/common";

const translate = translator(messages);

function initialPage() {
  try {
    const artifact = loadCanvasArtifact(localStorage);
    const original = localStorage.getItem(CANVAS_KEY);
    const backupKey = `showai.migration.v1:${artifact.document.id}`;
    if (original && artifact.version === 1 && !localStorage.getItem(backupKey))
      localStorage.setItem(backupKey, original);
    return {
      document: upgradeResource(artifact.document),
      components: artifact.components ?? [],
      error: "",
    };
  } catch {
    return {
      document: newDocument(),
      components: [] as CompiledComponent[],
      error: translate("readFailed"),
    };
  }
}

export default function App() {
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const [initial] = useState(initialPage);
  const [page, setPage] = useState(initial.document);
  const [components, setComponents] = useState(initial.components);
  const [error, setError] = useState(initial.error);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editorControls, setEditorControls] = useState<EditorControls | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [dark, setDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = useRef(page);
  const currentComponents = useRef(components);
const sourceOwner = useRef<OwnedSourceSession | undefined>(undefined);
  const pageComponents = useRef(new Map<string, CompiledComponent[]>());
  pageComponents.current.set(page.id, components);
  useEffect(() => {
    const owner = new OwnedSourceSession(
      "standalone-canvas",
      page.id,
      createSourceTransport(async () => {
        throw new Error("Standalone canvas has no native backend");
      }, `standalone-canvas:${location.origin}`),
    );
    sourceOwner.current = owner;
    setPage((value) => owner.replace(value));
    return () => {
      stopPortableInputs(owner);
      stopHistoryTravels(owner);
      void flushHistoryTravels(owner).then(()=>flushPortableInputs(owner, true))
        .then(async () => {
          const source = owner.document;
          if (source) {
            const artifact = {
              format: "showai" as const,
              version: 1 as const,
              document: source,
              components: pageComponents.current.get(owner.pageId) ?? [],
            };
            retainCanvasArtifact(localStorage, artifact);
            if (current.current.id === owner.pageId)
              saveCanvasArtifact(localStorage, artifact);
          }
          await owner.dispose();
          if (
            sourceOwner.current === owner ||
            sourceOwner.current?.pageId !== owner.pageId
          )
            pageComponents.current.delete(owner.pageId);
        })
        .catch((error) => {
          console.error("Standalone accepted ink could not retire", error);
        });
    };
  }, [page.id]);
  const blocked = useRef(!!initial.error);
  // While blocked, autosave is off; the notice stays until another page opens.
  const [saveBlocked, setSaveBlocked] = useState(!!initial.error);
  const importGeneration = useRef(0);
  current.current = page;
  currentComponents.current = components;

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = "auto";
      titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
    }
    document.title = page.title ? `${page.title} · ShowAI` : "ShowAI";
  }, [page.title]);

  const persist = useCallback(async () => {
    if (blocked.current) return;
    try {
      await flushHistoryTravels(sourceOwner.current);
      await flushPortableInputs(sourceOwner.current,false);
      saveCanvasArtifact(localStorage, {
        format: "showai",
        version: 1,
        document: current.current,
        components: currentComponents.current,
      });
      setError("");
    } catch {
      setError(t("saveFailed"));
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(persist, 300);
    return () => clearTimeout(timer);
  }, [page, components, persist]);

  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden") persist();
    };
    const guard=(event:BeforeUnloadEvent)=>{if(historyTravelsPending(sourceOwner.current)||portableInputsPending(sourceOwner.current)){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",guard);
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("beforeunload",guard);
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [persist]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !buttonRef.current?.contains(event.target as Node)
      )
        setMenuOpen(false);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        buttonRef.current?.focus();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const items = [
          ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]',
          ) ?? []),
        ];
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        event.preventDefault();
        items[
          (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length
        ]?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keys);
    };
  }, [menuOpen]);

  const update = useCallback((changes: Partial<ShowDocument>) => {
    setPage(document=>{
      if(changes.id!==undefined&&changes.id!==document.id)return document;
      const value={...document,...changes,updatedAt:new Date().toISOString()};
      return sourceOwner.current?.pageId===value.id?sourceOwner.current.replace(value):value;
    });
  }, []);

  async function exportPage(kind: "html" | "json" | "md") {
    setMenuOpen(false);
    setBusy(true);
    try {
      await flushHistoryTravels(sourceOwner.current);
      await flushPortableInputs(sourceOwner.current,true);
      await sourceOwner.current?.barrier();
      const source = current.current;
      const name = source.title.trim() || "ShowAI";
      if (kind === "html")
        downloadFile(
          `${name}.html`,
          await buildCanvasArtifactHtml({
            format: "showai",
            version: 1,
            document: source,
            components: currentComponents.current,
          }),
          "text/html;charset=utf-8",
        );
      if (kind === "json")
        downloadFile(
          `${name}.showai.json`,
          serializeArtifact(source, currentComponents.current),
          "application/json",
        );
      if (kind === "md")
        downloadFile(
          `${name}.md`,
          (source.title ? `# ${source.title}\n\n` : "") +
            toMarkdown(linearContent(source)),
          "text/markdown;charset=utf-8",
        );
      setNotice(t("exported"));
    } catch (reason) {
      setError(
        t("exportFailed", {
          reason: reason instanceof Error ? reason.message : t("tryAgain"),
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function openFile(file: File) {
    const request = ++importGeneration.current;
    setMenuOpen(false);
    if (file.size > CAPACITY.artifactBytes) {
      setError(
        t("fileTooLarge", {
          size: formatBytes(file.size),
          limit: formatBytes(CAPACITY.artifactBytes),
        }),
      );
      return;
    }
    try {
      const raw = await file.text();
      let incoming: ShowDocument;
      let incomingComponents: CompiledComponent[] = [];
      let remoteComponents: ShowArtifact["remoteComponents"];
      if (/\.(md|markdown|txt)$/i.test(file.name)) {
        incoming = newDocument(file.name.replace(/\.[^.]+$/, ""));
        incoming.content = parseMarkdown(raw);
        incoming = validateDocument(incoming);
      } else if (/\.html?$/i.test(file.name)) {
        const html = new DOMParser().parseFromString(raw, "text/html");
        const source =
          html.getElementById("showai-data") ??
          [...html.querySelectorAll('script[type="application/json"]')].find(
            (element) => /^showai-.+-data$/.test(element.id),
          );
        const artifact = parseArtifact(source?.textContent ?? "");
        incoming = artifact.document;
        incomingComponents = artifact.components ?? [];
        remoteComponents = artifact.remoteComponents;
      } else {
        const artifact = parseArtifact(raw);
        incoming = artifact.document;
        incomingComponents = artifact.components ?? [];
        remoteComponents = artifact.remoteComponents;
      }
      const materialized = await materializeCanvasArtifact({
        format: "showai",
        version: 1,
        document: incoming,
        components: incomingComponents,
        remoteComponents,
      });
      if (request !== importGeneration.current) return;
      incomingComponents = materialized.components ?? [];
      await flushHistoryTravels(sourceOwner.current);
      await flushPortableInputs(sourceOwner.current,true);
      if(request!==importGeneration.current)return;
      const outgoing=sourceOwner.current?.document??current.current;
      retainCanvasArtifact(localStorage, {
        format: "showai",
        version: 1,
        document: outgoing,
        components: currentComponents.current,
      });
      if (blocked.current)
        localStorage.setItem(
          "showai.canvas.recovery",
          localStorage.getItem(CANVAS_KEY) ?? "",
        );
      saveCanvasArtifact(localStorage, {
        format: "showai",
        version: 1,
        document: incoming,
        components: incomingComponents,
      });
      blocked.current = false;
      setSaveBlocked(false);
      setPage(incoming);
      setComponents(incomingComponents);
      setError("");
      window.scrollTo(0, 0);
    } catch (reason) {
      if (request !== importGeneration.current) return;
      setError(
        t("openFailed", {
          reason: reason instanceof Error ? reason.message : t("checkFormat"),
        }),
      );
    }
  }

  return (
    <div className="canvas-app">
      <div className="canvas-actions">
        <EditorHistoryButtons
          controls={
            editorControls?.documentId === page.id ? editorControls : null
          }
          className="canvas-icon-button"
        />
        <button
          className="canvas-icon-button"
          aria-label={t("exportPage")}
          title={t("exportPage")}
          disabled={busy}
          onClick={() => void exportPage("html")}
        >
          {busy ? (
            <span className="canvas-spinner" />
          ) : (
            <ArrowUpRight size={18} />
          )}
        </button>
        <div className="canvas-menu-anchor">
          <button
            ref={buttonRef}
            className="canvas-icon-button"
            aria-label={tc("pageOptions")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={tc("pageOptions")}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <MoreHorizontal size={19} />
          </button>
          {menuOpen && (
            <div
              ref={menuRef}
              className="canvas-menu"
              role="menu"
              aria-label={tc("pageOptions")}
              onBlur={(event) => {
                if (
                  !event.currentTarget.contains(event.relatedTarget as Node) &&
                  event.relatedTarget !== buttonRef.current
                )
                  setMenuOpen(false);
              }}
            >
              {editorControls?.documentId === page.id &&
                containerMenuItems(editorControls).map((item) =>
                  item.control ? (
                    <LibraryMenuControl key={item.label} item={item} />
                  ) : (
                    <button
                      key={item.label}
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        item.onSelect?.();
                      }}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  ),
                )}
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  fileRef.current?.click();
                }}
              >
                <Upload size={15} />
                {t("openPage")}
              </button>
              <button
                role="menuitem"
                disabled={busy}
                onClick={() => void exportPage("json")}
              >
                <FileJson size={15} />
                {tc("downloadSource")}
              </button>
              <button
                role="menuitem"
                disabled={busy}
                onClick={() => void exportPage("md")}
              >
                <FileText size={15} />
                {t("exportMarkdown")}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setDark(!dark);
                  setMenuOpen(false);
                }}
              >
                {dark ? <Sun size={15} /> : <Moon size={15} />}
                {dark ? tc("lightAppearance") : tc("darkAppearance")}
              </button>
            </div>
          )}
        </div>
      </div>
      {saveBlocked && (
        <div className="canvas-error canvas-blocked" role="alert">
          <span>
            {t("readFailed")} {t("blockedNotice")}
          </span>
          <button disabled={busy} onClick={() => void exportPage("json")}>
            {t("downloadCurrent")}
          </button>
        </div>
      )}
      {error && !(saveBlocked && error === initial.error) && (
        <div className="canvas-error" role="alert">
          <span>{error}</span>
          <button onClick={() => void exportPage("json")}>
            {tc("downloadSource")}
          </button>
          <button
            className="canvas-icon-button"
            aria-label={tc("dismissNotice")}
            onClick={() => setError("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <CustomComponentsProvider components={components}>
        <SurfaceEditor
          key={page.id}
          document={page}
          onControlsChange={setEditorControls}
          onChange={(next) => update(next)}
          header={
            <textarea
              ref={titleRef}
              className="surface-page-title"
              aria-label={t("pageTitle")}
              placeholder={tc("untitled")}
              rows={1}
              maxLength={1000}
              value={page.title}
              onChange={(event) =>
                update({ title: event.target.value.replaceAll("\n", "") })
              }
            />
          }
        />
      </CustomComponentsProvider>
      <input
        ref={fileRef}
        className="hidden"
        type="file"
        accept=".json,.md,.markdown,.txt,.html,.htm"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openFile(file);
          event.target.value = "";
        }}
      />
      {notice && (
        <div className="canvas-toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

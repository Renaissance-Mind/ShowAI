import { useEffect, useLayoutEffect, useRef, useState } from "react";
import PageThumbnailContent from "./PageThumbnailContent";
import type { LoadedPage } from "./usePage";
import { desktop, errorMessage } from "./bridge";
import "./studio.css";
import "./catalog-workspace.css";

/** Only the capture window receives this page's data; the directory gets a PNG. */
export default function PagePreviewPage() {
  const [record, setRecord] = useState<LoadedPage>();
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const stage = useRef<HTMLSpanElement>(null);
  const args = JSON.parse(
    new URLSearchParams(location.search).get("pagePreview")!,
  );
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = args.theme;
  }, [args.theme]);
  useEffect(() => {
    let current = true;
    void desktop.invoke<LoadedPage>("pages:previewData").then(
      (value) => {
        if (current) setRecord(value);
      },
      (reason) => {
        if (current) setError(errorMessage(reason));
      },
    );
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (!record || !stage.current) return;
    let current = true;
    const loaded = new Set<MessageEventSource>();
    const receive = (event: MessageEvent) => {
      if (event.data?.type === "showai:height" && event.source)
        loaded.add(event.source);
    };
    window.addEventListener("message", receive);
    void (async () => {
      await document.fonts.ready;
      const deadline = Date.now() + 11000;
      let stable = 0;
      let previous = "";
      while (current && stable < 3) {
        const element = stage.current!;
        const frames = [
          ...element.querySelectorAll<HTMLIFrameElement>(
            ".showai-custom-block iframe",
          ),
        ];
        const pending =
          element.querySelector(
            '[data-preview-pending="true"],[aria-busy="true"]',
          ) ||
          frames.some((frame) => !loaded.has(frame.contentWindow!)) ||
          [...element.querySelectorAll("img")].some((img) => !img.complete);
        const paper = element.querySelector<HTMLElement>(
          ".catalog-preview-content",
        );
        const layout = `${paper?.offsetWidth}:${paper?.offsetHeight}:${element.querySelector("[data-preview-scale]")?.getAttribute("data-preview-scale")}`;
        stable = !pending && layout === previous ? stable + 1 : 0;
        previous = layout;
        if (Date.now() > deadline)
          throw new Error("Page preview did not settle in time.");
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      if (current) setReady(true);
    })().catch((reason) => {
      if (current) setError(errorMessage(reason));
    });
    return () => {
      current = false;
      window.removeEventListener("message", receive);
    };
  }, [record]);
  return (
    <span
      ref={stage}
      className="studio-page-thumbnail page-capture-stage"
      data-preview-ready={ready && !error ? "true" : "false"}
      data-preview-error={error || undefined}
    >
      {record && (
        <PageThumbnailContent
          record={record}
          updatedAt={record.hash}
          padding={args.padding}
        />
      )}
      {error && <span role="alert">{error}</span>}
    </span>
  );
}

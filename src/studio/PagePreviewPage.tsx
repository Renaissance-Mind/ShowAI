import { useEffect, useLayoutEffect, useRef, useState } from "react";
import PageThumbnailContent from "./PageThumbnailContent";
import type { PagePreviewCapture } from "../desktop/bridge";
import { desktop, errorMessage } from "./bridge";
import "./studio.css";
import "./catalog-workspace.css";

/** Only the capture window receives this page's data; the directory gets a PNG. */
export default function PagePreviewPage() {
  const [capture, setCapture] = useState<PagePreviewCapture>();
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const stage = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (capture) document.documentElement.dataset.theme = capture.theme;
  }, [capture]);
  useEffect(() => {
    let generation = 0;
    const clear = () => {
      generation++;
      setCapture(undefined);
      setReady(false);
      setError("");
    };
    const load = () => {
      clear();
      const current = generation;
      void desktop.invoke<PagePreviewCapture>("pages:previewData").then(
        (value) => {
          if (current === generation) setCapture(value);
        },
        (reason) => {
          if (current === generation) setError(errorMessage(reason));
        },
      );
    };
    window.addEventListener("showai:page-preview", load);
    window.addEventListener("showai:page-preview-clear", clear);
    load();
    return () => {
      generation++;
      window.removeEventListener("showai:page-preview", load);
      window.removeEventListener("showai:page-preview-clear", clear);
    };
  }, []);
  useEffect(() => {
    if (!capture || !stage.current) return;
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
  }, [capture]);
  return (
    <span
      ref={stage}
      className="studio-page-thumbnail page-capture-stage"
      data-preview-ready={ready && !error ? "true" : "false"}
      data-preview-error={error || undefined}
      data-preview-id={capture?.id}
    >
      {capture && (
        <PageThumbnailContent
          key={capture.id}
          record={capture.record}
          updatedAt={capture.record.hash}
          padding={capture.padding}
        />
      )}
      {error && <span role="alert">{error}</span>}
    </span>
  );
}

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { ShowDocument } from "../types";
import { findSurfaceNode } from "./document.mjs";
import { inkNodes } from "./inline-ink";

function probe(parent: HTMLElement) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 1 1");
  svg.setAttribute("width", "1");
  svg.setAttribute("height", "1");
  svg.style.cssText =
    "position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  parent.append(svg);
  return svg;
}
const values = (m: DOMMatrix) =>
  [m.a, m.b, m.c, m.d, m.e, m.f].map((n) => Math.round(n * 1e6) / 1e6);
export function useInlineInk({
  root,
  world,
  document: source,
  boardId,
  tool,
  color,
  width,
  ruler,
  enabled,
  onCamera,
  onTool,
}: {
  root: RefObject<HTMLDivElement | null>;
  world: RefObject<HTMLDivElement | null>;
  document?: ShowDocument;
  boardId: string;
  tool: string | null | undefined;
  color: string;
  width: number;
  ruler: boolean;
  enabled: boolean;
  onCamera: (camera: { x: number; y: number; scale: number }) => void;
  onTool: (tool: string) => void;
}) {
  const current = useRef({ source, color, width, ruler, onCamera, onTool });
  current.current = { source, color, width, ruler, onCamera, onTool };
  useEffect(() => {
    const bridge = window.showai?.inlineInk;
    if (
      !bridge ||
      !enabled ||
      !source ||
      (tool !== "pen" && tool !== "highlighter") ||
      !root.current ||
      !world.current
    )
      return;
    const token = crypto.randomUUID(),
      surface = root.current,
      content = world.current,
      viewportProbe = probe(surface),
      worldProbe = probe(content);
    let alive = true,
      pending = false,
      failed = false,
      lastKey = "",
      lastDocument: ShowDocument | undefined,
      frame = 0,
      cameraVersion = 0;
    const command = bridge.onCommand((value) => {
      if (value.pageId !== source.id || value.boardId !== boardId) return;
      if (value.camera) {
        cameraVersion = value.cameraVersion ?? cameraVersion;
        current.current.onCamera(value.camera);
      }
      if (value.tool) current.current.onTool(value.tool);
    });
    const send = async () => {
      if (!alive || failed) return;
      frame = requestAnimationFrame(() => void send());
      if (
        pending ||
        !surface.getClientRects().length ||
        document.visibilityState === "hidden"
      )
        return;
      const documentValue = current.current.source;
      if (!documentValue) return;
      const viewport = viewportProbe.getScreenCTM(),
        worldMatrix = worldProbe.getScreenCTM();
      if (!viewport || !worldMatrix) return;
      const camera = viewport.inverse().multiply(worldMatrix),
        inverse = worldMatrix.inverse(),
        poses: Record<string, number[]> = {};
      const board = findSurfaceNode(documentValue, boardId)?.node;
      for (const node of inkNodes(board ?? { content: [] })) {
        const element = content.querySelector(
          `[data-surface-id="${CSS.escape(node.attrs!.id)}"] [data-native-ink]`,
        ) as SVGSVGElement | null;
        const m = element?.getScreenCTM();
        if (!m) return;
        poses[node.attrs!.id] = values(inverse.multiply(m));
      }
      const holes = [
        ...document.querySelectorAll<HTMLElement>(
          "[data-surface-ui],.surface-toolbar,.studio-context-menu,.studio-modal-shade,.container-inspector",
        ),
      ]
        .filter((element) => element.getClientRects().length)
        .map((element) => {
          const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
      const packet = {
        token,
        pageId: documentValue.id,
        boardId,
        tool: tool as "pen" | "highlighter",
        color: current.current.color,
        width: current.current.width,
        ruler: current.current.ruler,
        dark: document.documentElement.dataset.theme === "dark",
        widthPx: surface.clientWidth,
        heightPx: surface.clientHeight,
        viewport: values(viewport),
        camera: { x: camera.e, y: camera.f, scale: camera.a },
        cameraVersion,
        poses,
        holes,
      };
      const key = JSON.stringify(packet);
      if (key === lastKey && documentValue === lastDocument) return;
      pending = true;
      try {
        await bridge.frame({
          ...packet,
          ...(lastDocument !== documentValue
            ? { document: documentValue }
            : {}),
        });
        lastKey = key;
        lastDocument = documentValue;
        if (alive) {
          surface.dataset.nativeInkToken = token;
          surface.dataset.nativeInkActive = "true";
        }
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        pending = false;
      }
    };
    void send();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      command();
      viewportProbe.remove();
      worldProbe.remove();
      void bridge.hide(source.id, boardId, token).finally(() => {
        if (surface.dataset.nativeInkToken === token) {
          delete surface.dataset.nativeInkActive;
          delete surface.dataset.nativeInkToken;
        }
      });
    };
  }, [enabled, source?.id, boardId, tool, root, world]);
}

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
  const current = useRef({
    source,
    color,
    width,
    ruler,
    onCamera,
    onTool,
    tool,
  });
  const cameraRevision = useRef(0),
    previousInk = useRef("pen");
  if (tool === "pen" || tool === "highlighter") previousInk.current = tool;
  current.current = { source, color, width, ruler, onCamera, onTool, tool };
  useEffect(() => {
    const bridge = window.showai?.inlineInk;
    if (!bridge || !enabled || !source) return;
    return bridge.onCommand((value) => {
      if (value.pageId !== source.id || value.boardId !== boardId) return;
      if (value.camera) {
        cameraRevision.current = value.cameraVersion ?? cameraRevision.current;
        current.current.onCamera(value.camera);
      }
      if (value.tool)
        current.current.onTool(
          value.tool === "toggleEraser"
            ? current.current.tool === "eraser"
              ? previousInk.current
              : "eraser"
            : value.tool === "previous"
              ? previousInk.current
              : value.tool,
        );
    });
  }, [enabled, source?.id, boardId]);
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
      poseDocument: ShowDocument | undefined,
      poseSize = "",
      poses: Record<string, number[]> = {},
      lastPoses: Record<string, number[]> | undefined;
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
      const camera = viewport.inverse().multiply(worldMatrix);
      const size = surface.clientWidth + ":" + surface.clientHeight;
      if (poseDocument !== documentValue || poseSize !== size) {
        const inverse = worldMatrix.inverse(),
          next: Record<string, number[]> = {};
        const board = findSurfaceNode(documentValue, boardId)?.node;
        const elements = new Map(
          [...content.querySelectorAll<SVGSVGElement>("[data-native-ink]")].map(
            (element) => [
              element.closest<HTMLElement>("[data-surface-id]")?.dataset
                .surfaceId,
              element,
            ],
          ),
        );
        for (const node of inkNodes(board ?? { content: [] })) {
          const m = elements.get(node.attrs!.id)?.getScreenCTM();
          if (!m) return;
          next[node.attrs!.id] = values(inverse.multiply(m));
        }
        poses = next;
        poseDocument = documentValue;
        poseSize = size;
      }
      const holes = [
        ...document.querySelectorAll<HTMLElement>(
          "[data-surface-ui],.surface-toolbar,.studio-context-menu,.studio-modal-shade,.container-inspector,.studio-sidebar-shell:not([data-sidebar-mode=hidden]) .studio-sidebar,.studio-mobile-sidebar-edge,.studio-mobile-sidebar-scrim,.studio-mobile-navigation-tools",
        ),
      ]
        .filter(
          (element) =>
            !content.contains(element) &&
            element.getClientRects().length &&
            getComputedStyle(element).pointerEvents !== "none" &&
            getComputedStyle(element).visibility !== "hidden",
        )
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
        cameraVersion: cameraRevision.current,
        holes,
      };
      const key = JSON.stringify(packet);
      if (key === lastKey && documentValue === lastDocument) return;
      pending = true;
      try {
        await bridge.frame({
          ...packet,
          ...(lastPoses !== poses ? { poses } : {}),
          ...(lastDocument !== documentValue
            ? { document: documentValue }
            : {}),
        });
        lastKey = key;
        lastDocument = documentValue;
        lastPoses = poses;
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

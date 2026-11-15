import type { Camera } from "./model";

export interface BoardCaptureState {
  boardId: string;
  cameras?: Record<string, Camera>;
  pageScrolls?: Record<string, { x: number; y: number }>;
}

export function readingCapture(): BoardCaptureState | undefined {
  if (typeof window === "undefined") return;
  const text = window.document.getElementById(
    "showai-read-options",
  )?.textContent;
  return text ? JSON.parse(text).boardCapture : undefined;
}

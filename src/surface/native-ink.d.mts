export interface NativeInk {
  format: "showai-pencilkit-v1";
  drawing: string;
  preview: string;
  darkPreview?: string;
  strokeCount: number;
  extent?: [number, number];
}
export const NATIVE_INK_FORMAT: "showai-pencilkit-v1";
export const NATIVE_INK_MIME: "application/vnd.showai.pencilkit";
export function validateNativeInk(ink: unknown): NativeInk;

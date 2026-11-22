export function cursorWorkbenchArchive(
  source: string,
  options?: { runtimeConfig?: string; host?: "cursor" | "trae" },
): Promise<Buffer>;

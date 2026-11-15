export const LOCAL_MEDIA_SCHEME = "showai-media";

export function isLocalFileLink(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4096 && /^file:/i.test(value);
}

export function localMediaUrl(token: string): string {
  return (window as { __SHOWAI_LOCAL__?: unknown }).__SHOWAI_LOCAL__
    ? `/api/media/${token}`
    : `${LOCAL_MEDIA_SCHEME}://media/${token}`;
}

export function localMediaSource(): string | undefined {
  if (typeof window === "undefined" || !window.showai) return undefined;
  return (window as { __SHOWAI_LOCAL__?: unknown }).__SHOWAI_LOCAL__
    ? undefined
    : `${LOCAL_MEDIA_SCHEME}:`;
}

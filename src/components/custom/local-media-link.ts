/** Scheme the desktop app uses to stream granted local files to the workbench player. */
export const LOCAL_MEDIA_SCHEME = "showai-media";

/** Links components use for local files: `file:///absolute/path` or `file:~/path`. */
export function isLocalFileLink(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4096 && /^file:/i.test(value);
}

/** Address the workbench player loads a granted file from in the current host. */
export function localMediaUrl(token: string): string {
  return (window as { __SHOWAI_LOCAL__?: unknown }).__SHOWAI_LOCAL__
    ? `/api/media/${token}`
    : `${LOCAL_MEDIA_SCHEME}://media/${token}`;
}

/**
 * The source component frames load granted files from, for their content
 * policy: the desktop scheme. The browser workbench serves files from a
 * loopback address that opaque frames cannot reach, so it hands frames the
 * bytes instead (see CustomBlock); undefined there and without a host.
 */
export function localMediaSource(): string | undefined {
  if (typeof window === "undefined" || !window.showai) return undefined;
  return (window as { __SHOWAI_LOCAL__?: unknown }).__SHOWAI_LOCAL__
    ? undefined
    : `${LOCAL_MEDIA_SCHEME}:`;
}

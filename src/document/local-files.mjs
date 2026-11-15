export const LOCAL_FILE_TYPES = Object.freeze({
  ".png": { mime: "image/png", kind: "image" },
  ".jpg": { mime: "image/jpeg", kind: "image" },
  ".jpeg": { mime: "image/jpeg", kind: "image" },
  ".gif": { mime: "image/gif", kind: "image" },
  ".webp": { mime: "image/webp", kind: "image" },
  ".avif": { mime: "image/avif", kind: "image" },
  ".mp4": { mime: "video/mp4", kind: "video" },
  ".m4v": { mime: "video/mp4", kind: "video" },
  ".mov": { mime: "video/quicktime", kind: "video" },
  ".webm": { mime: "video/webm", kind: "video" },
  ".ogv": { mime: "video/ogg", kind: "video" },
  ".mp3": { mime: "audio/mpeg", kind: "audio" },
  ".m4a": { mime: "audio/mp4", kind: "audio" },
  ".aac": { mime: "audio/aac", kind: "audio" },
  ".wav": { mime: "audio/wav", kind: "audio" },
  ".ogg": { mime: "audio/ogg", kind: "audio" },
  ".oga": { mime: "audio/ogg", kind: "audio" },
  ".flac": { mime: "audio/flac", kind: "audio" },
  ".pdf": { mime: "application/pdf", kind: "pdf" },
});

const MAX_REFERENCE = 4096;

export function isLocalFileRef(value) {
  return (
    typeof value === "string" &&
    value.length <= MAX_REFERENCE &&
    /^file:/i.test(value) &&
    !/[\u0000-\u001f]/.test(value)
  );
}

export function localRefPath(value) {
  if (!isLocalFileRef(value)) return undefined;
  const rest = value.replace(/^file:(\/\/(localhost)?)?/i, "");
  try {
    return decodeURIComponent(rest);
  } catch {
    return undefined;
  }
}

export function localRefName(value) {
  const path = localRefPath(value);
  return path ? (path.split(/[\\/]/).filter(Boolean).at(-1) ?? "") : "";
}

export function localRefType(value) {
  const name = localRefName(value).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot < 0 ? undefined : LOCAL_FILE_TYPES[name.slice(dot)];
}

export function isLocalResourceRef(value, kind) {
  const type = localRefType(value);
  return !!type && (!kind || type.kind === kind);
}

export function isDetachedRef(value) {
  const path = localRefPath(value);
  return !!path && !/^(\/|~\/|[a-z]:[\\/])/i.test(path);
}

const encodePath = (path) =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

export function localFileRef(path) {
  const normal = String(path).replaceAll("\\", "/");
  if (/^[a-z]:\//i.test(normal)) return `file:///${encodePath(normal)}`;
  if (!normal.startsWith("/"))
    throw new Error("A local file reference needs an absolute path.");
  return `file://${encodePath(normal)}`;
}

export function detachedRef(value) {
  return `file:${encodeURIComponent(localRefName(value) || "file")}`;
}

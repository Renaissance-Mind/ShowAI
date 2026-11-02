// References to files on this device inside resource fields: images, video,
// audio and PDF. A reference is a string, so pages keep it through saving,
// history and sync; each device resolves it to its own file.
//
// Forms (each path segment encoded with encodeURIComponent):
//   file:///Users/me/Movies/clip.mp4   an absolute path
//   file:~/Movies/clip.mp4             a path under the home directory
//   file:clip.mp4                      only the file name: an export or copy
//                                      that left the file out keeps its name

/**
 * Types a local reference may point to, by extension. Images are raster
 * formats, the same set embedded images accept; SVG is left out because a
 * served SVG document could run script when opened outside an <img>.
 */
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

/** Any `file:` string, including links custom components open in the player. */
export function isLocalFileRef(value) {
  return (
    typeof value === "string" &&
    value.length <= MAX_REFERENCE &&
    /^file:/i.test(value) &&
    !/[\u0000-\u001f]/.test(value)
  );
}

/** The decoded path of a reference (`~/…` stays relative to home), or undefined. */
export function localRefPath(value) {
  if (!isLocalFileRef(value)) return undefined;
  const rest = value.replace(/^file:(\/\/(localhost)?)?/i, "");
  try {
    return decodeURIComponent(rest);
  } catch {
    return undefined;
  }
}

/** The file name a reference ends with. */
export function localRefName(value) {
  const path = localRefPath(value);
  return path ? (path.split(/[\\/]/).filter(Boolean).at(-1) ?? "") : "";
}

/** The type of the referenced file, from its extension. */
export function localRefType(value) {
  const name = localRefName(value).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot < 0 ? undefined : LOCAL_FILE_TYPES[name.slice(dot)];
}

/**
 * Whether a value is a local reference a resource field of this kind accepts
 * ("image", "video", "audio" or "pdf"). Without a kind, any supported type.
 */
export function isLocalResourceRef(value, kind) {
  const type = localRefType(value);
  return !!type && (!kind || type.kind === kind);
}

/** Whether a reference only names its file, without a location. */
export function isDetachedRef(value) {
  const path = localRefPath(value);
  return !!path && !/^(\/|~\/|[a-z]:[\\/])/i.test(path);
}

const encodePath = (path) =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

/** A reference for an absolute path chosen on this device. */
export function localFileRef(path) {
  const normal = String(path).replaceAll("\\", "/");
  if (/^[a-z]:\//i.test(normal)) return `file:///${encodePath(normal)}`;
  if (!normal.startsWith("/"))
    throw new Error("A local file reference needs an absolute path.");
  return `file://${encodePath(normal)}`;
}

/** A reference that keeps only the file name, for copies that leave the file out. */
export function detachedRef(value) {
  return `file:${encodeURIComponent(localRefName(value) || "file")}`;
}

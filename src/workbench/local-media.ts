import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { CoreError } from "../core/model";

/** Types the host player can show. Anything else is only revealed in the file manager. */
const MEDIA_TYPES: Record<string, { mime: string; kind: MediaKind }> = {
  ".mp4": { mime: "video/mp4", kind: "video" },
  ".m4v": { mime: "video/mp4", kind: "video" },
  ".mov": { mime: "video/quicktime", kind: "video" },
  ".webm": { mime: "video/webm", kind: "video" },
  ".mp3": { mime: "audio/mpeg", kind: "audio" },
  ".m4a": { mime: "audio/mp4", kind: "audio" },
  ".aac": { mime: "audio/aac", kind: "audio" },
  ".wav": { mime: "audio/wav", kind: "audio" },
  ".ogg": { mime: "audio/ogg", kind: "audio" },
  ".flac": { mime: "audio/flac", kind: "audio" },
  ".png": { mime: "image/png", kind: "image" },
  ".jpg": { mime: "image/jpeg", kind: "image" },
  ".jpeg": { mime: "image/jpeg", kind: "image" },
  ".gif": { mime: "image/gif", kind: "image" },
  ".webp": { mime: "image/webp", kind: "image" },
};

export type MediaKind = "video" | "audio" | "image";

export interface LocalMediaGrant {
  token: string;
  path: string;
  name: string;
  /** Present only when the host player can show the file. */
  kind?: MediaKind;
  mime?: string;
  size: number;
}

const LIFETIME = 6 * 60 * 60 * 1000;
const LIMIT = 200;

/** Absolute local path from a component link: an absolute path, `~/…`, or a `file:` URL. */
export function localMediaPath(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 4096)
    throw new CoreError("INVALID_PATH", "Choose a local file.");
  let path = value;
  if (/^file:/i.test(path)) {
    path = path.replace(/^file:(\/\/(localhost)?)?/i, "");
    try {
      path = decodeURIComponent(path);
    } catch {
      throw new CoreError("INVALID_PATH", "The file link is not valid.");
    }
    // file:///C:/dir names the drive path C:/dir on Windows.
    if (process.platform === "win32" && /^\/[a-z]:\//i.test(path)) path = path.slice(1);
  }
  if (path === "~" || path.startsWith("~/")) path = join(homedir(), path.slice(1));
  if (!isAbsolute(path) || path.includes("\0"))
    throw new CoreError(
      "INVALID_PATH",
      "Local file links need an absolute path or a path under ~/.",
    );
  return normalize(path);
}

/**
 * Short-lived capabilities for local files a reader asked to open.
 * The trusted workbench mints a grant after a user click; the media route only
 * serves files it can find here, so no frame can name arbitrary paths.
 */
export class LocalMediaGrants {
  private grants = new Map<string, LocalMediaGrant & { expires: number }>();

  constructor(private now: () => number = Date.now) {}

  async grant(value: unknown): Promise<LocalMediaGrant> {
    const requested = localMediaPath(value);
    const path = await realpath(requested).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR")
          throw new CoreError("NOT_FOUND", `File not found: ${requested}`);
        throw error;
      },
    );
    const info = await stat(path);
    if (!info.isFile())
      throw new CoreError("INVALID_PATH", `Not a file: ${requested}`);
    this.prune();
    const type = MEDIA_TYPES[extname(path).toLowerCase()];
    const grant: LocalMediaGrant = {
      token: randomUUID(),
      path,
      name: basename(path),
      size: info.size,
      ...(type ? { kind: type.kind, mime: type.mime } : {}),
    };
    this.grants.set(grant.token, { ...grant, expires: this.now() + LIFETIME });
    while (this.grants.size > LIMIT)
      this.grants.delete(this.grants.keys().next().value!);
    return grant;
  }

  resolve(token: string): LocalMediaGrant | undefined {
    const grant = this.grants.get(token);
    if (!grant || grant.expires <= this.now()) {
      this.grants.delete(token);
      return undefined;
    }
    return grant;
  }

  private prune() {
    const now = this.now();
    for (const [token, grant] of this.grants)
      if (grant.expires <= now) this.grants.delete(token);
  }
}

/** One grant store per host process, shared by the action layer and the media route. */
export const localMediaGrants = new LocalMediaGrants();

export interface MediaResponse {
  status: number;
  headers: Record<string, string>;
  body?: Readable;
}

/** Stream a granted file, honouring one `bytes=` range so players can seek. */
export async function localMediaResponse(
  token: string,
  range: string | null | undefined,
  head = false,
  grants: LocalMediaGrants = localMediaGrants,
): Promise<MediaResponse> {
  const grant = grants.resolve(token);
  if (!grant?.mime) return { status: 404, headers: {} };
  // The file may have changed since the grant; serve what is on disk now.
  const size = await stat(grant.path).then(
    (info) => (info.isFile() ? info.size : -1),
    () => -1,
  );
  if (size < 0) return { status: 404, headers: {} };
  const headers: Record<string, string> = {
    "Content-Type": grant.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  let start = 0,
    end = size - 1,
    status = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match && (match[1] || match[2])) {
      if (match[1]) {
        start = Number(match[1]);
        if (match[2]) end = Math.min(Number(match[2]), size - 1);
      } else start = Math.max(0, size - Number(match[2]));
    }
    if (!match || (!match[1] && !match[2]) || start > end || start >= size)
      return {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      };
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(size ? end - start + 1 : 0);
  return {
    status,
    headers,
    body: head || !size ? undefined : createReadStream(grant.path, { start, end }),
  };
}

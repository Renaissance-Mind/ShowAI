import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { CoreError } from "../core/model";
import { localFilePath } from "../core/local-resources";
import {
  LOCAL_FILE_TYPES,
  localRefName,
  type LocalResourceKind,
} from "../document/local-files.mjs";

/**
 * Types the workbench can show: the player opens video, audio and images,
 * resource fields also PDFs. Anything else is only revealed in the file manager.
 */
const MEDIA_TYPES: Readonly<Record<string, { mime: string; kind: MediaKind }>> =
  LOCAL_FILE_TYPES;

export type MediaKind = LocalResourceKind;

export interface LocalMediaGrant {
  token: string;
  path: string;
  name: string;
  /** Present only when the host player can show the file. */
  kind?: MediaKind;
  mime?: string;
  size: number;
  /** When the grant stops serving the file (epoch milliseconds). */
  expiresAt: number;
}

const LIFETIME = 6 * 60 * 60 * 1000;
// Pages may show many linked images at once; each file holds one reusable grant.
const LIMIT = 2000;

/** Absolute local path from a component link: an absolute path, `~/…`, or a `file:` URL. */
export const localMediaPath = localFilePath;

/**
 * Short-lived capabilities for local files a reader asked to open.
 * The trusted workbench mints a grant after a user click; the media route only
 * serves files it can find here, so no frame can name arbitrary paths.
 */
export class LocalMediaGrants {
  private grants = new Map<string, LocalMediaGrant>();
  /** Reusable grants by real path. */
  private byPath = new Map<string, string>();

  constructor(private now: () => number = Date.now) {}

  /**
   * A grant for a local file. `reuse` returns the live grant of the same file
   * with a renewed lifetime, so a page showing the file keeps a stable address.
   */
  async grant(
    value: unknown,
    options: { reuse?: boolean } = {},
  ): Promise<LocalMediaGrant> {
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
    return this.issue(path, basename(path), extname(path), info.size, options);
  }

  /**
   * A grant for the synchronized copy of another device's file (see
   * dataset-bundles), named and typed by the reference the page stores.
   */
  async grantCopy(path: string, ref: string): Promise<LocalMediaGrant> {
    const info = await stat(path);
    const name = localRefName(ref);
    return this.issue(path, name, extname(name), info.size, { reuse: true });
  }

  private issue(
    path: string,
    name: string,
    extension: string,
    size: number,
    options: { reuse?: boolean },
  ): LocalMediaGrant {
    this.prune();
    const expiresAt = this.now() + LIFETIME;
    if (options.reuse) {
      const token = this.byPath.get(path);
      const live = token ? this.grants.get(token) : undefined;
      if (live) {
        // Refresh its order too, so the oldest unused grants leave first.
        this.grants.delete(live.token);
        const renewed = { ...live, size, expiresAt };
        this.grants.set(live.token, renewed);
        return renewed;
      }
    }
    const type = MEDIA_TYPES[extension.toLowerCase()];
    const grant: LocalMediaGrant = {
      token: randomUUID(),
      path,
      name,
      size,
      expiresAt,
      ...(type ? { kind: type.kind, mime: type.mime } : {}),
    };
    this.grants.set(grant.token, grant);
    if (options.reuse) this.byPath.set(path, grant.token);
    while (this.grants.size > LIMIT) this.forget(this.grants.keys().next().value!);
    return grant;
  }

  resolve(token: string): LocalMediaGrant | undefined {
    const grant = this.grants.get(token);
    if (!grant || grant.expiresAt <= this.now()) {
      this.forget(token);
      return undefined;
    }
    return grant;
  }

  private forget(token: string) {
    const grant = this.grants.get(token);
    this.grants.delete(token);
    if (grant && this.byPath.get(grant.path) === token)
      this.byPath.delete(grant.path);
  }

  private prune() {
    const now = this.now();
    for (const [token, grant] of this.grants)
      if (grant.expiresAt <= now) this.forget(token);
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
    // The PDF reader fetches its file; images and media load without CORS,
    // so component frames still cannot read their pixels or samples.
    ...(grant.mime === "application/pdf"
      ? { "Access-Control-Allow-Origin": "*" }
      : {}),
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

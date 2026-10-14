export interface ReaderBucket {
  get(key: string): Promise<{
    body: unknown;
    httpEtag?: string;
    httpMetadata?: { contentType?: string };
  } | null>;
  head(key: string): Promise<unknown>;
  put(
    key: string,
    body: Uint8Array | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export function readerPath(
  pathname: string,
): { version: string; file: string } | null;
export function tarEntries(
  archive: Uint8Array,
): Generator<{ path: string; body: Uint8Array }>;
export function importVersion(
  version: string,
  bucket: ReaderBucket,
  fetcher?: Fetcher,
): Promise<boolean>;
export function handle(
  request: Request,
  env: { READER: ReaderBucket },
  fetcher?: Fetcher,
): Promise<Response>;
declare const worker: {
  fetch(request: Request, env: { READER: ReaderBucket }): Promise<Response>;
};
export default worker;

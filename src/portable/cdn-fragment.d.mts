export interface CdnReaderOptions {
  /** A single reader entry URL. */
  readerUrl?: string;
  /** Reader entry URLs tried in order; each serves the same build. */
  readerUrls?: string[];
  id?: string;
}
export function toCdnFragment(html: string, options: CdnReaderOptions): string;
export function toCdnPage(html: string, options: CdnReaderOptions): string;

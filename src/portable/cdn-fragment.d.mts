export interface CdnReaderOptions {
  readerUrl?: string;
  readerUrls?: string[];
  id?: string;
}
export function toCdnFragment(html: string, options: CdnReaderOptions): string;
export function toCdnPage(html: string, options: CdnReaderOptions): string;

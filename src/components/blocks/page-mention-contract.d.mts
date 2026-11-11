export interface DateData {
  /** YYYY-MM-DD */
  date: string;
}
export interface BacklinksData {
  title?: string;
  pageId?: string;
  projectId?: string;
}
export function validateDateData(data: unknown): DateData;
export function validateBacklinksData(data: unknown): BacklinksData;

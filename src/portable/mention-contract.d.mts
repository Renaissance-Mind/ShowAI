export interface MentionOption {
  label: string;
  value: string;
  keywords?: string;
}
/** How a component offers itself in the @ menu of rich text. */
export interface MentionContract {
  /** The top-level string prop the menu fills. */
  prop: string;
  /** date: today, tomorrow and typed dates. text: the typed text. options: only the fixed choices. */
  input: "date" | "text" | "options";
  options?: MentionOption[];
}
export const MENTION_INPUTS: readonly ["date", "text", "options"];
export function validateMentionContract(
  value: unknown,
  schema?: unknown,
): MentionContract;
export function isoDay(date: Date): string;
export function typedDays(query: string, today?: Date): string[];

import { getLocale, translator } from "../i18n";
import messages from "../i18n/messages/catalog";
import type { ComponentCategory } from "../contract/types";

type DisplayItem = { name: string; description: string } & (
  { kind: string } | { kind?: undefined }
);


const t = translator(messages);

export function componentCategoryLabel(id: ComponentCategory): string {
  return t(`category.${id}`);
}

export type BuiltinDisplayText = Record<
  string,
  { name: string; description: string }
>;

let builtinEnglish: BuiltinDisplayText = {};

export function registerBuiltinDisplayText(table: BuiltinDisplayText) {
  builtinEnglish = table;
}

function english(item: DisplayItem) {
  return getLocale() === "en" && item.kind
    ? builtinEnglish[item.kind]
    : undefined;
}

export function componentDisplayName(item: DisplayItem): string {
  return english(item)?.name ?? item.name;
}

export function componentDisplayDescription(item: DisplayItem): string {
  const text = english(item);
  if (!text) return item.description;
  return text.description;
}

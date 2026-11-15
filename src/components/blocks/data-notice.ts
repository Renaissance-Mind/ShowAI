import { translator } from "../../i18n";
import messages from "../../i18n/messages/widget";
import type { BlockProps } from "./types";

const t = translator(messages);

export function dataNotice(data: BlockProps["data"]) {
  const notice = (data as Record<string, unknown>).$dataState as
    | { status?: string; dataset?: string; file?: string; omitted?: boolean }
    | undefined;
  return notice?.status === "empty" ? notice : undefined;
}

export function unavailableText(data: BlockProps["data"]): string {
  const notice = dataNotice(data);
  if (!notice) return t("sharedDataUnavailable");
  const name = notice.dataset ?? "";
  if (notice.omitted)
    return notice.file
      ? t("sharedDataLeftOutFile", { name, file: notice.file })
      : t("sharedDataLeftOut", { name });
  return notice.file
    ? t("sharedDataEmptyFile", { name, file: notice.file })
    : t("sharedDataEmpty", { name });
}

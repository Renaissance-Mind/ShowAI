import { translator } from "../../i18n";
import messages from "../../i18n/messages/widget";
import type { BlockProps } from "./types";

const t = translator(messages);

/**
 * The notice dataset resolution leaves on a bound block that had no data
 * when a reader or export was made: the dataset and file name only, never a
 * path of the device (see core/dataset-resolution).
 */
export function dataNotice(data: BlockProps["data"]) {
  const notice = (data as Record<string, unknown>).$dataState as
    { status?: string; dataset?: string; file?: string } | undefined;
  return notice?.status === "empty" ? notice : undefined;
}

/** Why a reader or export shows no data for a bound block. */
export function unavailableText(data: BlockProps["data"]): string {
  const notice = dataNotice(data);
  if (!notice) return t("sharedDataUnavailable");
  const name = notice.dataset ?? "";
  return notice.file
    ? t("sharedDataEmptyFile", { name, file: notice.file })
    : t("sharedDataEmpty", { name });
}

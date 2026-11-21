import {
  antigravityWorkbenchCanReference,
  codexWorkbench,
  codexWorkbenchCanReference,
} from "../../browser/codex-workbench";
import { useTranslator } from "../../i18n/react";
import { dshWorkbenchCanReference } from "../../browser/dsh-workbench";
import messages from "../../i18n/messages/codex-workbench";

export function useCodexReferenceLabel() {
  const t = useTranslator(messages);
  if (dshWorkbenchCanReference()) return t("dshReference");
  if (antigravityWorkbenchCanReference()) return t("antigravityReference");
  const connection = codexWorkbench();
  return connection && codexWorkbenchCanReference()
    ? t(connection.mode === "thread" ? "reference" : "discuss")
    : undefined;
}

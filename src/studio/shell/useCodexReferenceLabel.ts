import { codexWorkbench, codexWorkbenchCanReference } from "../../browser/codex-workbench";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/codex-workbench";

export function useCodexReferenceLabel() {
  const t = useTranslator(messages);
  const connection = codexWorkbench();
  return connection && codexWorkbenchCanReference()
    ? t(connection.mode === "thread" ? "reference" : "discuss")
    : undefined;
}

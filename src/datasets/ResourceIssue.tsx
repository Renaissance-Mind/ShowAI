import { useCallback } from "react";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/datasets";
import { desktop } from "../studio/bridge";
import { isDetachedRef } from "../document/local-files.mjs";
import {
  useLocalFileChooser,
  type LocalResourceIssueProps,
} from "../components/local-resources";
import { DataEmptyState, type RunWarningAction } from "./DataWarnings";
import { resourceEntry } from "./warning-entries";
import "./datasets.css";

/**
 * The workbench's warning surface for a linked local file a resource field
 * cannot show: link another file (stored in the field), show where the file
 * was, or ask again once it is back.
 */
export function ResourceIssue({ view, kind, onReplace }: LocalResourceIssueProps) {
  const t = useTranslator(messages);
  const chooseFiles = useLocalFileChooser();
  const translate = useCallback(
    (key: string, values?: Record<string, unknown>) =>
      t(key as never, values as never),
    [t],
  );
  if (view.status !== "missing" && view.status !== "failed") return null;
  const entry = resourceEntry(
    {
      status: view.status,
      name: view.name,
      ...(view.message ? { message: view.message } : {}),
      located: !!view.ref && !isDetachedRef(view.ref),
    },
    {
      "link-file": !!onReplace && !!chooseFiles,
      "open-file": true,
      retry: true,
    },
    translate,
  );
  const run: RunWarningAction = async (action) => {
    switch (action) {
      case "link-file": {
        const [file] = (await chooseFiles?.(kind)) ?? [];
        if (file) onReplace?.(file.ref);
        return;
      }
      case "open-file":
        await desktop.invoke("media:reveal", { ref: view.ref });
        return;
      case "retry":
        view.retry();
        return;
    }
  };
  return <DataEmptyState entry={entry} run={run} allActions />;
}

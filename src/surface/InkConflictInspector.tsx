import {measureNativeSync} from "./native-perf";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ShowDocument } from "../types";
import { desktop, errorMessage } from "../studio/bridge";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/inkConflicts";
import { nativeDocumentBodiesEqual } from "./native-document-content";
import { inkWireResolutionCandidates } from "./ink-wire.mjs";

/** The prepare request may race any editor field, including metadata outside
 * the canvas. Only the storage acknowledgement timestamp is non-authoring. */
export async function acceptPreparedInkResolution(preparation:Promise<{baseline:ShowDocument;document:ShowDocument}>,
  getDocument:()=>ShowDocument,onResolve:(document:ShowDocument)=>void,staleMessage:string){
  const prepared=await preparation;
  if(!nativeDocumentBodiesEqual(prepared.baseline,getDocument()))throw new Error(staleMessage);
  onResolve(prepared.document);
}

/** One badge within the existing inspector; all choices become real persisted
 * author events before the owning PageSession performs its normal CAS save. */
export default function InkConflictInspector({ document, projectId, host, beforeResolve, getDocument, onResolve, readOnly = false }: {
  document: ShowDocument;
  projectId?: string;
  host?: HTMLElement | null;
  beforeResolve?: () => Promise<boolean>;
  getDocument: () => ShowDocument;
  onResolve: (document: ShowDocument) => void;
  readOnly?: boolean;
}) {
  const t = useTranslator(messages), groups = useMemo(() => measureNativeSync("surface.conflictInspector",()=>inkWireResolutionCandidates(document)), [document]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!groups.length) return null;
  const resolve = async (group: typeof groups[number], hash: string) => {
    if (busy || !projectId || readOnly) return;
    setBusy(true); setError("");
    try {
      if (beforeResolve && !await beforeResolve()) throw new Error(t("saved"));
      await acceptPreparedInkResolution(desktop.invoke<{ baseline: ShowDocument; document: ShowDocument }>("pages:prepareInkResolution", { projectId, pageId: document.id, choices: [{ boardId: group.boardId, strokeId: group.strokeId, field: group.field, hash }] }),getDocument,onResolve,t("stale"));
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  };
  const inspector=<details className={host ? "ink-conflict-inspector" : "surface-inspector ink-conflict-inspector"} data-surface-ui open>
    <summary>{t("title", { count: groups.length })}</summary>
    <p>{t("choose")}</p>
    {groups.map(group => <fieldset key={`${group.boardId}/${group.strokeId}/${group.field}`} disabled={busy || readOnly || !projectId}>
      <legend>{t("source", { id: group.strokeId.slice(0, 8) })} · {t(group.field as "ink")}</legend>
      {group.candidates.map((candidate, index) => {
        const scalar = typeof candidate.value === "string" || typeof candidate.value === "number" ? String(candidate.value) : t("variant", { index: index + 1 });
        const label = group.field === "alive" ? t(candidate.value ? "keep" : "remove") : t("chooseVariant", { value: scalar });
        return <button type="button" key={candidate.hash} onClick={() => void resolve(group, candidate.hash)} title={candidate.dots.join(", ")}>
          {group.field === "color" && typeof candidate.value === "string" && /^#[a-f\d]{3,8}$/i.test(candidate.value) && <span aria-hidden style={{ background: candidate.value, width: 12, height: 12, display: "inline-block", border: "1px solid currentColor", marginInlineEnd: 6 }} />}{label}
        </button>;
      })}
    </fieldset>)}
    {error && <p role="alert">{error}</p>}
  </details>;
  return host ? createPortal(inspector,host) : inspector;
}

// Shared by the desktop preload, the browser bridge and the main process:
// every close listener of a window answers, and a refusal always says why.
import type {
  CloseBlocker,
  CloseBlockerCode,
  CloseReport,
  CloseResult,
  CloseSource,
  UnsavedPage,
} from "./bridge";

/** A listener that has not answered by then is reported as LISTENER_TIMEOUT. */
export const CLOSE_LISTENER_TIMEOUT_MS = 15000;

export interface CloseListenerEntry {
  listener: () => Promise<CloseResult>;
  source: CloseSource;
}

const CODES = new Set<CloseBlockerCode>([
  "PAGE_NOT_RETAINED",
  "PAGE_NOT_SAVED",
  "PAGE_CONFLICT",
  "DATASET_NOT_RETAINED",
  "ASSISTANT_DRAFT_NOT_SAVED",
  "LISTENER_REFUSED",
  "LISTENER_FAILED",
  "LISTENER_TIMEOUT",
  "NO_REPLY",
]);
const SOURCES = new Set<CloseSource>([
  "pages",
  "datasets",
  "assistant",
  "sidebar",
  "workbench",
  "window",
]);

function errorText(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : String(error);
}

/** English one-line description, for logs and the plain `reason` field. */
export function describeBlocker(blocker: CloseBlocker): string {
  const subject = blocker.title
    ? `${blocker.source === "datasets" ? "dataset" : "page"} "${blocker.title}"`
    : blocker.pageId
      ? `page ${blocker.pageId}`
      : blocker.datasetId
        ? `dataset ${blocker.datasetId}`
        : blocker.source;
  const fallback: Record<CloseBlockerCode, string> = {
    PAGE_NOT_RETAINED: "changes could not be written to a local draft",
    PAGE_NOT_SAVED: "changes are not saved yet",
    PAGE_CONFLICT: "the save is held by a conflict with another writer",
    DATASET_NOT_RETAINED: "shared data changes could not be saved or kept",
    ASSISTANT_DRAFT_NOT_SAVED: "the assistant message draft could not be saved",
    LISTENER_REFUSED: "did not confirm that it can close",
    LISTENER_FAILED: "failed while preparing to close",
    LISTENER_TIMEOUT: `did not finish within ${blocker.seconds ?? "?"} s`,
    NO_REPLY: `the window did not answer within ${blocker.seconds ?? "?"} s`,
  };
  return `${subject}: [${blocker.code}] ${blocker.message || fallback[blocker.code]}`;
}

function pageBlocker(page: UnsavedPage, source: CloseSource): CloseBlocker {
  return {
    code: "PAGE_NOT_RETAINED",
    source,
    projectId: page.projectId,
    pageId: page.pageId,
    title: page.title,
    ...(page.reason ? { message: page.reason } : {}),
  };
}

/**
 * Runs every listener once and aggregates the answers. A listener still busy
 * from the previous request is awaited again instead of being started twice,
 * so "Try Again" after a timeout continues the same save.
 */
export function closeReporter(timeoutMs = CLOSE_LISTENER_TIMEOUT_MS) {
  const running = new Map<CloseListenerEntry, Promise<CloseResult>>();
  return async function report(
    entries: readonly CloseListenerEntry[],
  ): Promise<CloseReport> {
    const pages: UnsavedPage[] = [];
    const blockers: CloseBlocker[] = [];
    await Promise.all(
      entries.map(async (entry) => {
        let call = running.get(entry);
        if (!call) {
          call = Promise.resolve().then(entry.listener);
          running.set(entry, call);
          const started = call;
          void started.then(
            () => running.get(entry) === started && running.delete(entry),
            () => running.get(entry) === started && running.delete(entry),
          );
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<"timeout">((done) => {
          timer = setTimeout(() => done("timeout"), timeoutMs);
        });
        try {
          const result = await Promise.race([call, timeout]);
          if (result === "timeout") {
            blockers.push({
              code: "LISTENER_TIMEOUT",
              source: entry.source,
              seconds: Math.round(timeoutMs / 1000),
            });
            return;
          }
          if (result === true) return;
          if (result === false) {
            blockers.push({ code: "LISTENER_REFUSED", source: entry.source });
            return;
          }
          if (!result || typeof result !== "object") {
            blockers.push({ code: "LISTENER_REFUSED", source: entry.source });
            return;
          }
          if (result.allow === true) return;
          const listed = result.pages ?? [];
          pages.push(...listed);
          const own = result.blockers ?? [];
          blockers.push(
            ...own,
            // Pages without their own blocker still say which page and why.
            ...listed
              .filter(
                (page) =>
                  !own.some(
                    (blocker) =>
                      blocker.pageId === page.pageId &&
                      blocker.projectId === page.projectId,
                  ),
              )
              .map((page) => pageBlocker(page, entry.source)),
          );
          if (!own.length && !listed.length)
            blockers.push({ code: "LISTENER_REFUSED", source: entry.source });
        } catch (error) {
          blockers.push({
            code: "LISTENER_FAILED",
            source: entry.source,
            message: errorText(error).slice(0, 1000),
          });
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    return {
      allow: blockers.length === 0,
      pages,
      blockers,
      reason: blockers.map(describeBlocker).join("\n"),
    };
  };
}

const shortText = (value: unknown, limit: number) =>
  typeof value === "string" && value ? value.slice(0, limit) : undefined;

/** Blockers a renderer reported, checked before the main process uses them. */
export function closeBlockers(value: unknown): CloseBlocker[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item): CloseBlocker[] => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const code = raw.code as CloseBlockerCode;
    const source = raw.source as CloseSource;
    if (!CODES.has(code)) return [];
    const blocker: CloseBlocker = {
      code,
      source: SOURCES.has(source) ? source : "workbench",
    };
    const fields = {
      message: shortText(raw.message, 1000),
      projectId: shortText(raw.projectId, 200),
      pageId: shortText(raw.pageId, 200),
      datasetId: shortText(raw.datasetId, 200),
      title: shortText(raw.title, 200),
    };
    for (const [key, text] of Object.entries(fields))
      if (text) (blocker as unknown as Record<string, string>)[key] = text;
    if (typeof raw.seconds === "number" && Number.isFinite(raw.seconds))
      blocker.seconds = Math.max(0, Math.round(raw.seconds));
    return [blocker];
  });
}

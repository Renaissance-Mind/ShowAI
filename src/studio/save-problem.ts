/**
 * Classifies a page save failure for the save banner: what failed, whether
 * the person's edits are safe (from the session's real draft state), and
 * which follow-ups can work for this cause.
 */
import type { JSONContent } from "@tiptap/core";
import { translator } from "../i18n";
import pageSessionMessages from "../i18n/messages/pageSession";
import commonMessages from "../i18n/messages/common";
import {
  describeError,
  problemFacts,
  type ProblemDescription,
  type ProblemSafety,
} from "./problems";

const t = translator(pageSessionMessages);
const common = translator(commonMessages);

export type SaveFailureKind = "diskFull" | "permission" | "capacity" | "other";
/** Follow-ups the save banner can offer, most useful first. */
export type SaveFailureOffer =
  | "retry"
  | "keepCopy"
  | "librarySpace"
  | "reveal"
  | "locateLargest"
  | "discard";

export interface SaveFailureState {
  error: string;
  failure?: unknown;
  /** Edits exist that the formal page file does not contain. */
  dirty: boolean;
  /** The latest edit is written to a local draft. */
  draftDurable: boolean;
  title?: string;
}

export interface SaveFailure {
  kind: SaveFailureKind;
  safety: ProblemSafety;
  problem: ProblemDescription;
  offers: SaveFailureOffer[];
  /** Absolute path named by the system error, for revealing. */
  path?: string;
}

/** The fixed safety line comes from the session, never from the error text. */
export function saveSafety(state: Pick<SaveFailureState, "dirty" | "draftDurable">): ProblemSafety {
  if (!state.dirty) return "saved";
  return state.draftDurable ? "draftKept" : "windowOnly";
}

export function saveFailureKind(failure: unknown): SaveFailureKind {
  const facts = problemFacts(failure ?? "");
  if (facts.errno === "ENOSPC" || facts.errno === "EDQUOT") return "diskFull";
  if (["EACCES", "EPERM", "EROFS"].includes(facts.errno ?? ""))
    return "permission";
  if (facts.code === "CAPACITY_EXCEEDED") return "capacity";
  return "other";
}

export function describeSaveFailure(state: SaveFailureState): SaveFailure {
  const safety = saveSafety(state);
  const kind = saveFailureKind(state.failure);
  const object = state.title || common("untitled");
  const described = describeError(state.failure ?? state.error, {
    action: t("save.action"),
    object,
    safety,
    source: "save",
  });
  const facts = problemFacts(state.failure ?? state.error);
  // Retrying or copying into the same full or unwritable library fails again.
  // Discarding loads the formal file and always ends the failure.
  const offers: SaveFailureOffer[] = [
    ...(kind === "diskFull"
      ? (["retry", "librarySpace"] as const)
      : kind === "permission"
        ? ([...(facts.path ? (["reveal"] as const) : []), "retry"] as const)
        : kind === "capacity"
          ? (["locateLargest", "retry"] as const)
          : (["retry", "keepCopy"] as const)),
    "discard",
  ];
  const problem: ProblemDescription =
    kind === "other"
      ? {
          ...described,
          // The banner has no technical details, so an unknown cause shows
          // the original text; session messages are already sentences.
          cause: described.cause ?? (facts.message || state.error),
        }
      : {
          ...described,
          title: t(`save.title.${kind}`, { title: object }),
          cause: t(`save.cause.${kind}`),
        };
  return {
    kind,
    safety,
    problem,
    offers,
    ...(facts.path ? { path: facts.path } : {}),
  };
}

function size(node: JSONContent) {
  return JSON.stringify(node).length;
}

/**
 * Finds the block that contributes most to the page's size: descend into the
 * largest child while it holds most of its parent's bytes.
 */
export function largestBlock(content: JSONContent | undefined): string | null {
  let node = content;
  let found: string | null = null;
  while (node?.content?.length) {
    const child = node.content.reduce((best, item) =>
      size(item) > size(best) ? item : best,
    );
    // Stop at a found block whose bytes are spread over several children.
    if (found && size(child) < size(node) * 0.6) break;
    if (typeof child.attrs?.id === "string") found = child.attrs.id;
    node = child;
  }
  return found;
}

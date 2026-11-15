import type { JSONContent } from "@tiptap/core";
import { translator } from "../i18n";
import pageSessionMessages from "../i18n/messages/pageSession";
import commonMessages from "../i18n/messages/common";
import {
  describeError,
  problemFacts,
  type ProblemDescription,
  type ProblemSafety,
} from "../problems";

const t = translator(pageSessionMessages);
const common = translator(commonMessages);

export type SaveFailureKind = "diskFull" | "permission" | "capacity" | "other";
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
  dirty: boolean;
  draftDurable: boolean;
  title?: string;
}

export interface SaveFailure {
  kind: SaveFailureKind;
  safety: ProblemSafety;
  problem: ProblemDescription;
  offers: SaveFailureOffer[];
  path?: string;
}

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

export function largestBlock(content: JSONContent | undefined): string | null {
  let node = content;
  let found: string | null = null;
  while (node?.content?.length) {
    const child = node.content.reduce((best, item) =>
      size(item) > size(best) ? item : best,
    );
    if (found && size(child) < size(node) * 0.6) break;
    if (typeof child.attrs?.id === "string") found = child.attrs.id;
    node = child;
  }
  return found;
}

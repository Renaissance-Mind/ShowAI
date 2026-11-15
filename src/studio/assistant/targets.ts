import type { AssistantTarget } from "../../components/assistant-context";
import type {
  AgentComponentContext,
  AgentTarget,
} from "../../agent-host/types";
import type { CanvasReference } from "../../surface/agent-reference";
import {
  referenceVersion,
  type PageReference,
} from "../../core/page-reference";
import type { Translator } from "../../i18n";
import type strings from "../../i18n/messages/assistant";

type Translate = Translator<(typeof strings)["catalogs"]["zh-CN"]>;

export function agentTarget(
  pageId: string | null,
  target: AssistantTarget | null,
  reference?: CanvasReference | null,
  components?: AgentComponentContext[],
): AgentTarget {
  return {
    kind: target?.kind ?? "page",
    ...(pageId ? { pageId } : {}),
    ...(target && "blockIds" in target && target.blockIds.length
      ? { blockIds: target.blockIds }
      : {}),
    ...(target?.kind === "board" && target.surfaceId
      ? { surfaceId: target.surfaceId }
      : {}),
    ...(target?.kind === "text" && target.text ? { text: target.text } : {}),
    ...(reference ? { reference } : {}),
    ...(components?.length ? { components } : {}),
  };
}

export function referenceHeading(t: Translate, reference: PageReference) {
  const params = {
    title: reference.title || t("pageReference.untitled"),
    version: referenceVersion(reference),
  };
  if (reference.kind === "page") return t("pageReference.headingPage", params);
  if (reference.kind === "board")
    return reference.nodeIds?.length
      ? t("pageReference.headingBoard", {
          ...params,
          count: reference.nodeIds.length,
        })
      : t("pageReference.headingBoardAll", params);
  return t("pageReference.headingSelection", {
    ...params,
    count: reference.blockIds?.length ?? 0,
  });
}

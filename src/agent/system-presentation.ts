import { createHash } from "node:crypto";
import { builtinTemplateBundles } from "../core/builtin-template-bundles";
import {
  parseTemplateBundle,
  SYSTEM_TEMPLATE_ID,
  TEMPLATE_STAGES,
  type TemplateStage,
} from "../portable/template-bundle.mjs";
import { compareCatalogVersions } from "./disclosure";
const base = builtinTemplateBundles
  .map(parseTemplateBundle)
  .filter((bundle) => bundle.metadata.id === SYSTEM_TEMPLATE_ID)
  .sort((a, b) =>
    compareCatalogVersions(b.metadata.version, a.metadata.version),
  )[0]!;
export function systemPresentationGuide(
  stage?: TemplateStage,
  knownHash?: string,
) {
  if (stage && !TEMPLATE_STAGES.includes(stage))
    throw new Error("Unknown presentation stage.");
  const markdown = stage ? base.guides[stage]!.markdown : base.body;
  const hash = createHash("sha256").update(markdown).digest("hex");
  return {
    topic: "presentation",
    id: SYSTEM_TEMPLATE_ID,
    version: base.metadata.version,
    required: true,
    stage: stage ?? "baseline",
    hash,
    unchanged: knownHash === hash,
    ...(knownHash === hash ? {} : { markdown }),
    stages: TEMPLATE_STAGES.map((name) => ({
      stage: name,
      next: {
        tool: "guide",
        arguments: { topic: "presentation", stage: name },
      },
    })),
    rule: "The baseline applies to every presentation. Read phase detail when needed; selected template phase guides add task-specific instructions.",
  };
}

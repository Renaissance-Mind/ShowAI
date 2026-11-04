import { createHash } from "node:crypto";
import { builtinTemplateBundles } from "../core/builtin-template-bundles";
import {
  parseTemplateBundle,
  SYSTEM_TEMPLATE_ID,
} from "../portable/template-bundle.mjs";
import { compareCatalogVersions } from "./disclosure";
const base = builtinTemplateBundles
  .map(parseTemplateBundle)
  .filter((bundle) => bundle.metadata.id === SYSTEM_TEMPLATE_ID)
  .sort((a, b) =>
    compareCatalogVersions(b.metadata.version, a.metadata.version),
  )[0]!;
/** The whole presentation workflow, as embedded in the show-document Skill. */
export const systemPresentationMarkdown = [
  base.body,
  ...base.guides.map(({ markdown }) => markdown.trim()),
].join("\n\n");
export function systemPresentationGuide(knownHash?: string) {
  const hash = createHash("sha256")
    .update(systemPresentationMarkdown)
    .digest("hex");
  return {
    topic: "presentation",
    id: SYSTEM_TEMPLATE_ID,
    version: base.metadata.version,
    required: true,
    hash,
    unchanged: knownHash === hash,
    ...(knownHash === hash ? {} : { markdown: systemPresentationMarkdown }),
    rule: "This is the body of the show-document Skill: read it once per task. Selected templates add the methods for their kind of content through template_context.",
  };
}
